import * as v from 'valibot';
import { LRU } from '../domain/lru.js';
import { AppError } from '../domain/errors.js';
import { RankingStore, type Scored } from './store.js';
import { RankingOptions, requiredInputs, type Fact, type Input, type OrderResult, type Signature, type Source, type Storage } from './types.js';

interface Scan {
  mode: 'full' | 'known';
  /** Empty starts enumeration; null means enumeration finished and obsolete rows can be collected. */
  cursor: string | null;
  started: number;
  signature: Signature;
  wake: number;
  version: number;
}
interface Collection {
  id: string;
  revision: number;
  signature?: Signature;
  snapshot?: { started: number; completed: number; inputs: Input[] };
  job?: Scan;
}
type Memo = { records: Scored[] } | { oversized: true };
type Pause = Extract<OrderResult, { status: 'paused' }>;

/** A scan acquires an interval, not a purported atomic or uniformly fresh remote snapshot. */
export class RankingEngine {
  readonly store: RankingStore;
  readonly options: RankingOptions;
  #inputs: Input[];
  #orders = new LRU<Memo>(4 * 1024 * 1024);
  #running?: { state: Collection; work: Promise<Pause | undefined> };
  constructor(storage: Storage, options: RankingOptions, readonly now: () => number = Date.now) {
    this.options = v.parse(RankingOptions, options);
    this.#inputs = requiredInputs(this.options.profiles);
    this.store = new RankingStore(storage, this.options, now);
  }
  allowRequests(count = 1): void {
    const retryAt = this.store.request(count);
    if (retryAt) throw new AppError(429, 'RANKING_BUDGET', 'Ranking allowance exhausted.', Math.max(1, Math.ceil((retryAt - this.now()) / 1000)));
  }
  #state(id: string): Collection {
    return this.#running?.state.id === id ? this.#running.state : this.store.get<Collection>(id) ?? { id, revision: 0 };
  }
  #save(state: Collection): void {
    this.store.save(state.id, state, state.job?.wake ?? null);
  }
  async request(thread: string, profile: string, source: Source): Promise<OrderResult> {
    const definition = this.options.profiles[profile];
    if (!definition) throw Error('Unknown ranking profile.');
    const blocked = this.store.blocked();
    if (blocked) return { status: 'paused', reason: 'budget', retryAt: blocked };
    const state = this.#state(thread);
    if (state.job || !state.snapshot || !this.#inputs.every(input => state.snapshot!.inputs.includes(input)) || this.now() >= state.snapshot.completed + this.options.refreshSeconds * 1000) {
      if (this.#running && this.#running.state.id !== thread) return { status: 'preparing', retryAt: this.now() + 1000 };
      const paused = await this.#run(state, source);
      if (paused) return paused;
      if (state.job) return { status: 'preparing', retryAt: state.job.wake ?? this.now() + 1000 };
    }
    const key = JSON.stringify([thread, definition]);
    let order = this.#orders.get(key);
    if (!order) {
      const blocked = this.store.blocked();
      if (blocked) return { status: 'paused', reason: 'budget', retryAt: blocked };
      try {
        order = { records: this.store.order(thread, definition) };
        this.#orders.set(key, order, order.records.reduce((bytes, item) => bytes + item.id.length * 2 + 88, 128));
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'RANKING_SIZE') throw error;
        order = { oversized: true };
        this.#orders.set(key, order, 128);
      }
      this.store.checkpoint();
    }
    if ('oversized' in order) return { status: 'paused', reason: 'size', retryAt: null };
    const { started, completed } = state.snapshot!;
    return { status: 'ready', ids: order.records.map(item => item.id), interval: { started, completed }, nextRefreshAt: completed + this.options.refreshSeconds * 1000, revision: state.revision };
  }
  async #run(state: Collection, source: Source): Promise<Pause | undefined> {
    if (this.#running) return this.#running.state.id === state.id ? this.#running.work : undefined;
    const work = Promise.resolve().then(() => this.#scan(state, source));
    this.#running = { state, work };
    try { return await work; }
    finally { this.#running = undefined; }
  }
  async #scan(state: Collection, source: Source): Promise<Pause | undefined> {
    try {
      if (state.job?.wake && state.job.wake > this.now()) {
        const blocked = this.store.blocked(1);
        return blocked ? { status: 'paused', reason: 'budget', retryAt: blocked } : undefined;
      }
      if (!state.job) {
        this.allowRequests();
        const started = this.now(), signature = await source.head();
        const full = !state.snapshot || !this.#inputs.every(input => state.snapshot!.inputs.includes(input)) || (signature.rootCount !== state.signature?.rootCount || signature.newestRootID !== state.signature?.newestRootID);
        state.job = { mode: full ? 'full' : 'known', cursor: '', started, signature, wake: this.now(), version: ++state.revision };
        this.#save(state);
      }
      for (let steps = 0; steps < 4 && state.job; steps++) {
        const scan: Scan = state.job;
        const blocked = this.store.blocked();
        if (blocked) {
          scan.wake = blocked;
          this.#save(state);
          return { status: 'paused', reason: 'budget', retryAt: blocked };
        }
        if (scan.mode === 'full' && scan.cursor === null) {
          if (this.store.prune(state.id, scan.version, 800)) { this.#orders.clear(); continue; }
          await this.#publish(state, source);
          break;
        }
        const version = state.revision;
        if (scan.mode === 'full') {
          this.allowRequests();
          const page = await source.discover(scan.cursor || null, this.#inputs);
          if (page.cursor !== null && page.cursor === scan.cursor) throw Error('Ranking enumeration did not advance.');
          this.store.storage.transactionSync(() => {
            if (this.store.apply(state.id, page.candidates, [], version, scan.version)) this.#orders.clear();
            this.store.save(state.id, { ...state, job: { ...scan, cursor: page.cursor } }, scan.wake);
          });
          scan.cursor = page.cursor;
        } else {
          const ids = this.store.ids(state.id, scan.cursor || '', this.#inputs.includes('replies') ? 500 : 800);
          if (!ids.length) { await this.#publish(state, source); break; }
          this.allowRequests();
          const candidates = await source.observe(ids, this.#inputs);
          if (candidates.length !== ids.length) throw Error('Incomplete ranking batch.');
          const next: Scan = candidates.some(item => item === null)
            ? { ...scan, mode: 'full', cursor: '' }
            : { ...scan, cursor: ids[ids.length - 1]! };
          this.store.storage.transactionSync(() => {
            if (this.store.apply(state.id, candidates, ids, version)) this.#orders.clear();
            this.store.save(state.id, { ...state, job: next }, next.wake);
          });
          state.job = next;
        }
      }
      if (state.job) { state.job.wake = this.now() + 1000; this.#save(state); }
    } catch (error) {
      const failure = error as { code?: string; retryAt?: number; retryAfter?: number };
      console.warn('Ranking acquisition paused:', failure.code ?? 'UPSTREAM', error instanceof Error ? error.message : 'Unknown failure');
      const budget = failure.code === 'RANKING_BUDGET';
      const retryAt = failure.retryAt ?? this.now() + (failure.retryAfter ?? 60) * 1000;
      if (budget && state.job) state.job.wake = retryAt;
      else delete state.job;
      this.#save(state);
      return { status: 'paused', reason: budget ? 'budget' : 'upstream', retryAt };
    }
  }
  async #publish(state: Collection, source: Source): Promise<void> {
    const scan = state.job!;
    this.allowRequests();
    const signature = await source.head();
    if (signature.rootCount !== scan.signature.rootCount || signature.newestRootID !== scan.signature.newestRootID) {
      state.job = { ...scan, mode: 'full', cursor: '', signature, version: ++state.revision };
      this.#save(state); return;
    }
    state.signature = scan.signature;
    state.snapshot = { started: scan.started, completed: this.now(), inputs: this.#inputs };
    delete state.job;
    this.#save(state);
  }
  async continueJobs(source: (thread: string) => Promise<Source> | Source): Promise<void> {
    const next = this.store.next();
    if (next && next.wake <= this.now()) await this.#run(this.#state(next.thread), await source(next.thread));
  }
  nextAlarmAt(): number | null { return this.store.next()?.wake ?? null; }
  /** Confirmed facts update SQL directly. A returning acquisition cannot replace a newer row version. */
  correct(thread: string, fact: Fact): void {
    const state = this.#state(thread);
    if (!state.snapshot && !state.job) return;
    const next = { ...state, revision: state.revision + 1 };
    try {
      this.store.storage.transactionSync(() => {
        this.store.correct(thread, fact, next.revision, state.job?.version ?? state.revision);
        this.#save(next);
      });
      state.revision = next.revision; state.snapshot = next.snapshot;
      for (const profile of Object.values(this.options.profiles)) {
        const key = JSON.stringify([thread, profile]), memo = this.#orders.get(key);
        if (!memo) continue;
        if ('oversized' in memo) { this.#orders.clear(); continue; }
        const records = memo.records.filter(item => item.id !== fact.id);
        records.push(...this.store.order(thread, profile, fact.id));
        records.sort((a, b) => b.score - a.score || (profile.tieBreak === 'oldest' ? a.created - b.created : b.created - a.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const bytes = records.reduce((n, item) => n + item.id.length + 3, 2) - (records.length ? 1 : 0);
        this.#orders.set(key, bytes > this.options.maxOrderBytes ? { oversized: true } : { records }, bytes > this.options.maxOrderBytes ? 128 : records.reduce((n, item) => n + item.id.length * 2 + 88, 128));
      }
      this.store.checkpoint();
    } catch (error) { this.#orders.clear(); throw error; }
  }
}
