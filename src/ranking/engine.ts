import type {MutationResult} from '../contracts/results.js';
import {LRU} from '../domain/lru.js';
import {AppError} from '../domain/errors.js';
import { order } from './order.js';
import { RankingStore, type Cost } from './store.js';
import { requiredInputs, validCandidate, validateOptions, type Candidate, type Input, type OrderResult, type RankingOptions, type Source, type SourceFailure, type Storage } from './types.js';
const DAY = 86_400_000;
interface Job {
  phase: 'discover' | 'catchup' | 'finalize' | 'observe';
  auditRevision: number;
  groupLimit: number;
  full: boolean;
  cursor: string | null;
  fence: string | null;
  newest: string | null;
  pages: number;
  startedAt: number;
  earliest: number;
  offset: number;
  retries: string[];
  failures: number;
  batch: number;
  calls: number;
  wakeAt: number;
  inputs: Input[];
}
interface Thread {
  id: string;
  revision: number;
  count: number;
  groups: number;
  complete: boolean;
  inputs: Input[];
  observedAt: number;
  auditedAt: number;
  verifiedAt: number;
  fence: string | null;
  lastPassMs: number;
  scanPages: number;
  policy: string;
  job?: Job;
  pause?: { reason: 'budget' | 'upstream' | 'freshness' | 'size' | 'inputs'; retryAt: number | null };
}
/** One instance per repository authority. Ordinary comments never await its job lock. */
export class RankingEngine {
  readonly options: RankingOptions;
  readonly store: RankingStore;
  #states = new Map<string, Thread>();
  #running = new Map<string, Promise<void>>();
  #orders=new LRU<{revision:number;ids:string[]}>(4*1024*1024);
  #input: Input[];
  constructor(storage: Storage, options: RankingOptions, readonly now: () => number = Date.now) {
    this.options = validateOptions(options);
    this.store = new RankingStore(storage, this.options, now);
    this.#input = requiredInputs(this.options.profiles);
  }
  /** Preliminary HTTP work is charged before sending, including token renewal. */
  reserveAccess(requests=1):void{
    const admission=this.store.reserve({reads:0,writes:0,requests});
    if(!admission.accepted)throw new AppError(429,'RANKING_BUDGET','Ranking allowance exhausted.',Math.max(1,Math.ceil((admission.retryAt-this.now())/1000)));
  }
  observeResult(thread:string,operation:string,result:MutationResult,replyTo?:string|null):void{
    const countsReplies=Object.values(this.options.profiles).some(p=>(p.weights.replies??0)!==0);
    if(replyTo){if(operation==='delete'&&countsReplies)this.invalidate(thread);return;}
    if(result.removed){this.observeMutation(thread,{id:result.id,deleted:true});return;}
    if(result.reactions){
      const values:Candidate['values']={};for(const group of result.reactions.reactionGroups)values[group.content]=group.users.totalCount;
      if(result.id!==thread)this.observePartial(thread,result.id,values);
      return;
    }
    if(result.comment){
      const item=result.comment;
      if(item.replyTo){if(operation==='comment'&&countsReplies)this.invalidate(thread);}
      else if(operation==='comment')this.invalidate(thread);
      else if(operation!=='edit')this.observePartial(thread,item.id,{answer:item.isAnswer?1:0},!item.isMinimized);
    }
  }
  #state(id: string): Thread {
    if (!id || id.length > 200) throw new Error('Invalid discussion ID.');
    let state = this.#states.get(id);
    if (!state) {
      state = this.store.get<Thread>(id) ?? { id, revision: 0, count: 0, groups: 0, complete: false, inputs: [], observedAt: 0, auditedAt: 0, verifiedAt: 0, fence: null, lastPassMs: 0, scanPages: 0, policy: JSON.stringify(this.options) };
      if (state.policy !== JSON.stringify(this.options)) {
        state.policy = JSON.stringify(this.options);
        if (state.pause?.retryAt === null) delete state.pause;
        if (state.job && this.#input.some(input => !state!.job!.inputs.includes(input))) delete state.job;
      }
      this.#states.set(id, state);
    }
    return state;
  }
  #save(state: Thread): void { this.store.save(state.id, state); }
  #reserve(state: Thread, cost: Cost): boolean {
    const admission = this.store.reserve(cost);
    if (admission.accepted) return true;
    state.pause = { reason: 'budget', retryAt: admission.retryAt };
    if (state.job) state.job.wakeAt = admission.retryAt;
    if (this.store.reserve({ reads: 0, writes: 3, requests: 0 }, true).accepted) this.#save(state);
    else this.store.invalidateAll();
    return false;
  }
  #begin(state: Thread): void {
    const full = !state.complete || this.now() - state.auditedAt >= DAY || state.verifiedAt <= this.store.budget().invalidatedAt;
    if (state.scanPages) this.store.clearScan(state.id);
    state.scanPages = 0;
    state.job = { phase: full ? 'discover' : 'catchup', auditRevision: state.revision, groupLimit: 0, full, cursor: null, fence: full ? null : state.fence, newest: null, pages: 0, startedAt: this.now(), earliest: this.now(), offset: 0, retries: [], failures: 0, batch: this.#input.includes('replies') ? 500 : 800, calls: 0, wakeAt: this.now(), inputs: [...this.#input] };
    delete state.pause;
    this.#save(state);
  }
  async request(thread: string, profile: string, source: Source): Promise<OrderResult> {
    const definition = this.options.profiles[profile];
    if (!definition) throw new Error('Unknown ranking profile.');
    const state = this.#state(thread);
    if (state.job && state.job.startedAt <= this.store.budget().invalidatedAt) { state.complete = false; delete state.job; }
    const required = requiredInputs({ [profile]: definition });
    if (this.store.budget().blockedUntil > this.now()) return { status: 'paused', reason: 'budget', retryAt: this.store.budget().blockedUntil };
    if (state.pause?.reason === 'size') return { status: 'paused', ...state.pause };
    const ready = () => state.complete && required.every(input => state.inputs.includes(input)) && state.observedAt > 0 && this.now() - state.observedAt <= this.options.maxAgeSeconds * 1000 && state.verifiedAt > this.store.budget().invalidatedAt;
    if (!ready()) {
      if (state.pause?.retryAt === null) return { status: 'paused', ...state.pause };
      if (state.pause?.retryAt && state.pause.retryAt > this.now()) return { status: 'paused', ...state.pause };
      if (!state.job) {
        if (!this.#reserve(state, { reads: 4, writes: state.scanPages + 5, requests: 0 })) return { status: 'paused', ...state.pause! };
        this.#begin(state);
      }
      await this.#run(state, source);
    }
    if (!ready()) return state.pause ? { status: 'paused', ...state.pause } : { status: 'preparing', retryAt: Math.max(this.now() + 1000, state.job?.wakeAt ?? 0) };
    const key=JSON.stringify([thread,definition]);
    let memo=this.#orders.get(key);
    if(!memo||memo.revision!==state.revision){
      if (!this.#reserve(state, { reads: this.store.cached(thread) ? 0 : state.groups, writes: 0, requests: 0 })) return { status: 'paused', ...state.pause! };
      try {
        const dataset = this.store.load(thread);
        const candidates = function* () { for (const group of dataset.groups.values()) yield* group.records; };
        memo={revision:state.revision,ids:order(candidates(),definition,this.options.maxOrderBytes)};
        this.#orders.set(key,memo,memo.ids.reduce((n,id)=>n+id.length*2+24,128));
      } catch (error) {
        state.pause = { reason: error instanceof Error && error.message === 'RANKING_SIZE' ? 'size' : 'inputs', retryAt: null };
        if (this.store.reserve({ reads: 0, writes: 3, requests: 0 }, true).accepted) this.#save(state);
        return { status: 'paused', ...state.pause };
      }
    }
    return { status: 'ready', ids: memo.ids, observedAt: state.observedAt, revision: state.revision };
  }
  /** Called by the existing alarm. Completed work installs no further alarm. */
  async continueJobs(source: (thread: string) => Promise<Source> | Source): Promise<void> {
    if (this.store.budget().blockedUntil > this.now()) return;
    const next = this.store.nextJob();
    if (!next || next.wake > this.now()) return;
    const state = this.#state(next.thread);
    if (!state.job) {
      if (this.store.reserve({ reads: 0, writes: 3, requests: 0 }, true).accepted) this.#save(state);
      return;
    }
    if (state.job.startedAt <= this.store.budget().invalidatedAt) {
      state.complete = false; delete state.job;
      if (!this.#reserve(state, { reads: 4, writes: state.scanPages + 5, requests: 0 })) return;
      this.#begin(state);
    }
    try { await this.#run(state, await source(state.id)); }
    catch { this.#stop(state, 'upstream', this.now() + 60_000); }
  }
  nextAlarmAt(): number | null {
    const next = this.store.nextJob();
    return next ? Math.max(this.now() + 1000, next.wake, this.store.budget().blockedUntil) : null;
  }
  #stop(state: Thread, reason: 'upstream' | 'inputs', retryAt: number): void {
    state.pause = { reason, retryAt };
    delete state.job;
    if (this.store.reserve({ reads: 0, writes: 3, requests: 0 }, true).accepted) this.#save(state);
    else this.store.invalidateAll();
  }
  async #run(state: Thread, source: Source): Promise<void> {
    const previous = this.#running.get(state.id);
    if (previous) return previous;
    const work = this.#work(state, source);
    this.#running.set(state.id, work);
    try { await work; } finally { this.#running.delete(state.id); }
  }
  async #work(state: Thread, source: Source): Promise<void> {
    const started = this.now();
    for (let calls = 0; calls < 4 && this.now() - started < 4000 && state.job; calls++) {
      const job = state.job;
      if (job.wakeAt > this.now()) return;
      delete state.pause;
      try {
        if (job.phase === 'finalize') { await this.#membershipComplete(state, job); this.#save(state); }
        else if (job.phase === 'observe') await this.#observe(state, job, source);
        else await this.#discover(state, job, source);
      } catch (error) {
        const failure = error as SourceFailure;
        const cooldown = failure.retryAt ?? (failure.retryAfter ? this.now() + failure.retryAfter * 1000 : 0);
        if (failure.code && ['PERMISSION', 'PUBLIC_ONLY', 'CONFIGURATION', 'NOT_FOUND', 'CATEGORY', 'GITHUB_AUTH'].includes(failure.code)) { this.#stop(state, 'upstream', this.now() + 60_000); }
        else if (cooldown > this.now()) { state.pause = { reason: failure.code==='RANKING_BUDGET'?'budget':'upstream', retryAt: cooldown }; job.wakeAt = cooldown; }
        else if (failure.message === 'RANKING_SIZE') { state.pause = { reason: 'size', retryAt: null }; delete state.job; }
        else if (++job.failures >= 3) { this.#stop(state, 'upstream', this.now() + 60_000); }
        else { job.batch = Math.max(1, Math.floor(job.batch / 2)); job.wakeAt = this.now() + 1000; }
        // The step reservation includes its failure checkpoint and alarm.
        this.#save(state);
        return;
      }
      if (state.pause) return;
    }
    if (state.job && state.job.wakeAt <= this.now()) state.job.wakeAt = this.now() + 1000;
    if (state.job) this.#save(state);
  }
  async #discover(state: Thread, job: Job, source: Source): Promise<void> {
    const restore = this.store.cached(state.id) ? 0 : state.groups;
    // Up to 100 new locators, up to 100 scattered group writes, one scan page,
    // reservation, state checkpoints and alarm bookkeeping, including recovery.
    if (!this.#reserve(state, { reads: restore + 4, writes: 6, requests: 1 })) return;
    const revision = state.revision, observed = this.now();
    const page = await source.discover(job.cursor, job.inputs); job.calls++;
    if (state.job !== job) return;
    if (!page.complete || page.candidates.length > 100 || page.candidates.some(candidate => !validCandidate(candidate, job.inputs))) throw new Error('Incomplete ranking discovery page.');
    if (page.cursor === job.cursor && page.cursor !== null) throw new Error('Ranking pagination made no progress.');
    const ids = page.candidates.map(candidate => candidate.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate ranking discovery node.');
    if (job.newest === null && ids.length) job.newest = ids[0]!;
    const boundary = job.phase === 'catchup' && job.fence ? ids.indexOf(job.fence) : -1;
    const selected = boundary >= 0 ? page.candidates.slice(0, boundary) : page.candidates;
    const cost = this.store.estimate(state.id, selected, [], revision);
    if (!this.#reserve(state, { ...cost, writes: cost.writes + 4 })) return;
    const applied = this.store.apply(state.id, selected, [], revision);
    job.retries.push(...applied.conflicts);
    if (applied.changed) state.revision++;
    this.store.appendScan(state.id, job.pages++, selected.map(candidate => candidate.id));
    state.scanPages = job.pages;
    job.earliest = Math.min(job.earliest, observed);
    job.cursor = page.cursor;
    job.failures = 0;
    const data = this.store.load(state.id); state.count = data.locations.size; state.groups = data.groups.size;
    if (data.bytes > 32 * 1024 * 1024) throw new Error('RANKING_SIZE');
    if (boundary >= 0 || page.cursor === null) {
      if (job.phase === 'discover') {
        // Enumerating took time; catch additions since its first page before
        // publishing. A local insertion never changes this completed fence.
        job.phase = 'catchup'; job.fence = job.newest; job.cursor = null; job.newest = null;
        if (!job.fence) job.phase = 'finalize';
      } else {
        if (boundary < 0 && page.cursor === null) job.full = true;
        job.phase = 'finalize';
      }
    }
    this.#save(state);
  }
  async #membershipComplete(state: Thread, job: Job): Promise<void> {
    const data = this.store.load(state.id);
    if (job.full) {
      // First read the scan, then reserve the actual absent-ID upper bound.
      // Charging deletion of every candidate would needlessly block imports.
      if (!this.#reserve(state, { reads: job.pages + data.groups.size, writes: 2, requests: 0 })) return;
      const seen = this.store.scanIds(state.id);
      const absent = [...data.locations.keys()].filter(id => !seen.has(id));
      if (!this.#reserve(state, { reads: 0, writes: absent.length * 2 + job.pages + 5, requests: 0 })) return;
      const changed = this.store.apply(state.id, [], absent, job.auditRevision);
      job.retries.push(...changed.conflicts);
      if (changed.changed) state.revision++;
      state.auditedAt = this.now();
    } else if (!this.#reserve(state, { reads: 0, writes: job.pages + 5, requests: 0 })) return;
    this.store.clearScan(state.id); state.scanPages = 0;
    state.count = data.locations.size; state.groups = data.groups.size;
    state.complete = true;
    state.fence = job.newest ?? job.fence;
    if (job.full && this.now() - job.earliest <= this.options.maxAgeSeconds * 1000 && !job.retries.length) {
      this.#finish(state, job); return;
    }
    // Full membership is retained across a long/bootstrap pass. Refresh only
    // compact inputs now; do not enumerate every ID a second time.
    job.phase = 'observe'; job.offset = 0; job.groupLimit = 0; for (const group of data.groups.keys()) job.groupLimit = Math.max(job.groupLimit, group + 1); job.earliest = this.now(); job.startedAt = this.now(); job.calls = 0;
    job.retries = [...new Set(job.retries)];
    let requests = 0, filled = 0;
    for (const group of data.groups.values()) {
      if (!group.records.length) continue;
      if (filled && filled + group.records.length > job.batch) { requests++; filled = 0; }
      filled += group.records.length;
    }
    if (filled) requests++;
    requests += Math.ceil(job.retries.length / job.batch);
    if (requests > this.options.maxRequestsPerHour || state.lastPassMs > this.options.maxAgeSeconds * 1000) {
      state.pause = { reason: 'freshness', retryAt: null }; delete state.job;
    } else if (requests > this.options.maxRequestsPerHour - this.store.budget().requests) {
      job.wakeAt = (this.store.budget().hour + 1) * 3_600_000;
      state.pause = { reason: 'budget', retryAt: job.wakeAt };
    }
  }
  async #observe(state: Thread, job: Job, source: Source): Promise<void> {
    const restore = this.store.cached(state.id) ? 0 : state.groups;
    // A warm dataset is already admitted and performs no storage work here.
    // Reserve restoration only when this thread must be loaded from SQLite.
    if (restore && !this.#reserve(state, { reads: restore, writes: 2, requests: 0 })) return;
    const data = this.store.load(state.id);
    if (!job.retries.length) {
      const capacity = job.inputs.includes('replies') ? 500 : 800;
      for (const group of data.groups.values()) {
        if (group.number < job.offset || group.number >= job.groupLimit) continue;
        if (job.retries.length && job.retries.length + group.records.length > capacity) break;
        job.retries.push(...group.records.map(record => record.id));
        job.offset = group.number + 1;
      }
      if (!job.retries.length) {
        if (!this.#reserve(state, { reads: 0, writes: 3, requests: 0 })) return;
        this.#finish(state, job); return;
      }
    }
    const ids = job.retries.slice(0, job.batch);
    if (!this.#reserve(state, { reads: 2, writes: 5, requests: 1 })) return;
    this.#save(state);
    if (job.calls === 0) { job.startedAt = this.now(); job.earliest = this.now(); }
    const revision = state.revision, observed = this.now();
    const result = await source.observe(ids, job.inputs); job.calls++;
    if (state.job !== job) return;
    if (result.candidates.length + result.deleted.length > ids.length) throw new Error('Oversized ranking observation.');
    const wanted = new Set(ids), accepted = new Set<string>();
    const candidates = result.candidates.filter(candidate => wanted.has(candidate.id) && validCandidate(candidate, job.inputs));
    if (result.candidates.some(candidate => !wanted.has(candidate.id)) || result.deleted.some(id => !wanted.has(id))) throw new Error('Ranking observation returned an unrequested ID.');
    if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length || candidates.some(candidate => result.deleted.includes(candidate.id))) throw new Error('Conflicting ranking observations.');
    for (const candidate of candidates) accepted.add(candidate.id);
    for (const id of result.deleted) accepted.add(id);
    for (const id of result.unresolved ?? []) accepted.delete(id);
    const incoming = candidates.filter(candidate => accepted.has(candidate.id)), deleted = result.deleted.filter(id => accepted.has(id));
    const cost = this.store.estimate(state.id, incoming, deleted, revision);
    if (!this.#reserve(state, { ...cost, writes: cost.writes + 3 })) return;
    const applied = this.store.apply(state.id, incoming, deleted, revision);
    for (const id of applied.conflicts) accepted.delete(id);
    if (applied.changed) state.revision++;
    job.retries.splice(0, ids.length);
    job.retries.push(...ids.filter(id => !accepted.has(id)));
    job.retries = [...new Set(job.retries)];
    job.earliest = Math.min(job.earliest, observed);
    if (accepted.size < ids.length) {
      job.batch = Math.max(1, Math.floor(job.batch / 2));
      if (++job.failures >= 3) this.#stop(state, 'inputs', this.now() + 60_000);
    } else job.failures = 0;
    const updated = this.store.load(state.id);
    state.count = updated.locations.size; state.groups = updated.groups.size;
    if (state.job === job && job.offset >= job.groupLimit && !job.retries.length) this.#finish(state, job);
    this.#save(state);
  }
  #finish(state: Thread, job: Job): void {
    state.lastPassMs = this.now() - job.startedAt;
    state.observedAt = job.earliest;
    state.inputs = [...job.inputs];
    state.verifiedAt = this.now();
    state.revision++;
    delete state.job;
    if (this.now() - job.earliest > this.options.maxAgeSeconds * 1000) state.pause = { reason: 'freshness', retryAt: null };
    else delete state.pause;
    this.#save(state);
  }
  /** Counter-only mutations reuse stored stable fields without another read from GitHub. */
  observePartial(thread: string, id: string, values: Partial<Candidate['values']>, eligible?: boolean): void {
    const state = this.#state(thread);
    if (!state.complete && !state.job) return;
    if (!this.store.reserve({ reads: 2, writes: 0, requests: 0 }).accepted) { this.invalidate(thread); return; }
    const previous = this.store.candidate(thread, id);
    if (!previous) { this.invalidate(thread); return; }
    this.observeMutation(thread, { ...previous, ...(eligible === undefined ? {} : { eligible }), values: { ...previous.values, ...values } });
  }
  invalidate(thread: string): void {
    const state = this.#state(thread);
    if (!state.complete && !state.job) return;
    state.revision++; state.complete = false; state.observedAt = 0;
    delete state.job; delete state.pause;
    if (this.store.reserve({ reads: 0, writes: 3, requests: 0 }, true).accepted) this.#save(state);
    else this.store.invalidateAll();
  }
  /** Invoke only after GitHub confirms a write. Its failure must never fail that write. */
  observeMutation(thread: string, candidate: Candidate | { id: string; deleted: true }): void {
    const state = this.#state(thread);
    if (!state.complete && !state.job) return; // No requested ranking collection exists.
    const full = 'deleted' in candidate || validCandidate(candidate, this.#input);
    if (!full || !this.store.reserve({ reads: 3, writes: 5, requests: 0 }).accepted) {
      this.invalidate(thread);
      return;
    }
    try {
      this.store.transaction(() => {
        state.revision++;
        if (state.pause?.reason === 'size') delete state.pause;
        const found = this.store.mutate(thread, candidate, state.revision);
        if (!found) { state.complete = false; delete state.job; }
        const cached = this.store.cached(thread);
        if (cached) { state.count = cached.locations.size; state.groups = cached.groups.size; }
        this.#save(state);
      });
    } catch {
      state.complete = false;
      this.store.invalidateAll();
    }
  }
}
