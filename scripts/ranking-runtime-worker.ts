import { DurableObject } from 'cloudflare:workers';
import { RankingEngine } from '../src/ranking/engine.js';
import { DEFAULT_RANKING_LIMITS, type Candidate, type Source } from '../src/ranking/types.js';
export class RankingProof extends DurableObject {
  #now = 1_800_000_000_000;
  #reads = 0;
  #writes = 0;
  #groupsWritten = 0;
  #calls = 0;
  #engine!: RankingEngine;
  #storage: ConstructorParameters<typeof RankingEngine>[0];
  #overrides = new Map<number, number>();
  #configure(limits: Partial<typeof DEFAULT_RANKING_LIMITS> = {}) { this.#engine = new RankingEngine(this.#storage, { ...DEFAULT_RANKING_LIMITS, ...limits, profiles: { popular: { weights: { THUMBS_UP: 1 }, tieBreak: 'oldest' } } }, () => this.#now); }
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const sql = { exec: (query: string, ...args: (string | number | null)[]) => {
      const result = ctx.storage.sql.exec(query, ...args), rows = result.toArray();
      this.#reads += result.rowsRead; this.#writes += result.rowsWritten;
      if (/^(INSERT INTO|UPDATE|DELETE FROM) ranking_groups/.test(query)) this.#groupsWritten += result.rowsWritten;
      return rows;
    } };
    this.#storage = { sql, transactionSync: action => ctx.storage.transactionSync(action) };
    this.#configure();
  }
  #record(index: number): Candidate { return { id: 'DC_kwRanking' + index.toString().padStart(12, '0'), created: 1_700_000_000_000 + index, eligible: true, values: { THUMBS_UP: this.#overrides.get(index) ?? index % 103 } }; }
  #source(count: number): Source {
    return {
      discover: async cursor => { this.#calls++; const offset = Number(cursor ?? 0); return { candidates: Array.from({ length: Math.min(100, count - offset) }, (_, i) => this.#record(count - 1 - offset - i)), cursor: offset + 100 < count ? String(offset + 100) : null, complete: true }; },
      observe: async ids => { this.#calls++; return { candidates: ids.map(id => this.#record(Number(id.slice(12)))), deleted: [] }; },
    };
  }
  async run({ count, refresh = false, limits }: { count: number; refresh?: boolean; limits?: Partial<typeof DEFAULT_RANKING_LIMITS> }) {
    if (limits) this.#configure(limits);
    this.#reads = 0; this.#writes = 0; this.#groupsWritten = 0; this.#calls = 0;
    if (refresh) this.#now += (DEFAULT_RANKING_LIMITS.maxAgeSeconds + 1) * 1000;
    const source = this.#source(count), windows: unknown[] = [];
    for (let step = 0; step < 2000; step++) {
      const result = await this.#engine.request('thread', 'popular', source);
      if (result.status === 'ready') return { status: result.status, count: result.ids.length, first: result.ids[0], observedAt: result.observedAt, now: this.#now, reads: this.#reads, writes: this.#writes, candidateRowsWritten: this.#groupsWritten, calls: this.#calls, budget: this.#engine.store.budget(), windows, alarm: this.#engine.nextAlarmAt() };
      if (result.status === 'paused' && result.reason !== 'budget') return result;
      if (result.status === 'paused') windows.push({ now: this.#now, budget: { ...this.#engine.store.budget() } });
      this.#now = Math.max(this.#now + 1, result.retryAt ?? this.#now + 1000);
    }
    throw new Error('Ranking preparation exceeded the test step bound.');
  }
  async steady({ count, mutations = 0 }: { count: number; mutations?: number }) {
    let applied = 0;
    const start = (Math.floor(this.#now / 86_400_000) + 1) * 86_400_000;
    const totals = { reads: 0, writes: 0, candidateRowsWritten: 0, calls: 0, requests: 0 };
    for (let index = 0; index < 144; index++) {
      this.#now = start + index * (DEFAULT_RANKING_LIMITS.maxAgeSeconds + 1) * 1000 + 1;
      const result = await this.run({ count });
      if (result.status !== 'ready' || !('writes' in result) || result.windows.length) throw new Error('Steady ranking exhausted its daily allocation.');
      totals.requests++;
      for (let read = 0; read < 69; read++) {
        const ready = await this.#engine.request('thread', 'popular', this.#source(count));
        if (ready.status !== 'ready') throw new Error('A cached order became unavailable.');
        totals.requests++;
      }
      const target = Math.floor((index + 1) * mutations / 144);
      while (applied < target) {
        const candidateIndex = applied % count; this.#overrides.set(candidateIndex, 1000 + applied);
        this.#engine.observePartial('thread', this.#record(candidateIndex).id, { THUMBS_UP: 1000 + applied });
        const ready = await this.#engine.request('thread', 'popular', this.#source(count));
        if (ready.status !== 'ready') return { status: ready.status, result: ready, applied, cycle: index, budget: this.#engine.store.budget() };
        applied++; totals.requests++;
      }
      totals.reads += this.#reads; totals.writes += this.#writes; totals.candidateRowsWritten += this.#groupsWritten; totals.calls += this.#calls;
    }
    return { ...totals, appliedMutations: applied, budget: this.#engine.store.budget(), maxAgeSeconds: DEFAULT_RANKING_LIMITS.maxAgeSeconds, start, end: this.#now, alarm: this.#engine.nextAlarmAt() };
  }
  async restore() {
    this.#reads = 0; this.#writes = 0;
    const data = this.#engine.store.load('thread');
    return { count: data.locations.size, groups: data.groups.size, reads: this.#reads, writes: this.#writes };
  }
}
export default { async fetch(request: Request, env: { PROOF: DurableObjectNamespace<RankingProof> }) {
  const input = await request.json() as { name: string; action: 'run' | 'restore' | 'steady'; count: number; refresh?: boolean };
  const stub = env.PROOF.get(env.PROOF.idFromName(input.name));
  return Response.json(input.action === 'restore' ? await stub.restore() : input.action === 'steady' ? await stub.steady(input) : await stub.run(input));
} };
