import type { Candidate, RankingOptions, Storage } from './types.js';
export const GROUP_SIZE = 128;
const DAY = 86_400_000, HOUR = 3_600_000;
export interface Cost { reads: number; writes: number; requests: number }
interface Budget { day: number; hour: number; reads: number; writes: number; requests: number; invalidatedAt: number; blockedUntil: number }
export interface Group { number: number; generation: number; records: Candidate[] }
export interface Dataset { groups: Map<number, Group>; locations: Map<string, number>; bytes: number }
/** No ranking tables are created until an enabled engine is instantiated. */
export class RankingStore {
  #cache: { thread: string; data: Dataset } | undefined;
  #budget: Budget | undefined;
  #depth = 0;
  constructor(readonly storage: Storage, readonly options: RankingOptions, readonly now: () => number) {
    const sql = storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_groups (thread TEXT NOT NULL, number INTEGER NOT NULL, generation INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(thread,number)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_locations (thread TEXT NOT NULL, id TEXT NOT NULL, number INTEGER NOT NULL, PRIMARY KEY(thread,id)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_states (thread TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_scan (thread TEXT NOT NULL, page INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(thread,page)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_jobs (thread TEXT PRIMARY KEY, wake INTEGER NOT NULL) WITHOUT ROWID');
    sql.exec('CREATE INDEX IF NOT EXISTS ranking_jobs_wake ON ranking_jobs(wake)');
    sql.exec('CREATE TABLE IF NOT EXISTS ranking_budget (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  }
  transaction<T>(action: () => T): T {
    if (this.#depth) return action();
    try { return this.storage.transactionSync(() => { this.#depth++; try { return action(); } finally { this.#depth--; } }); }
    catch (error) { this.#cache = undefined; this.#budget = undefined; throw error; }
  }
  get<T>(thread: string): T | undefined {
    const row = [...this.storage.sql.exec('SELECT value FROM ranking_states WHERE thread=?', thread)][0];
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  save(thread: string, value: unknown): void {
    this.storage.sql.exec('INSERT INTO ranking_states(thread,value) VALUES(?,?) ON CONFLICT(thread) DO UPDATE SET value=excluded.value', thread, JSON.stringify(value));
    const state = value as { job?: { wakeAt: number }; pause?: { retryAt: number | null } };
    if (state.job && state.pause?.retryAt !== null) this.storage.sql.exec('INSERT INTO ranking_jobs(thread,wake) VALUES(?,?) ON CONFLICT(thread) DO UPDATE SET wake=excluded.wake WHERE ranking_jobs.wake != excluded.wake', thread, state.job.wakeAt);
    else this.storage.sql.exec('DELETE FROM ranking_jobs WHERE thread=?', thread);
  }
  nextJob(): { thread: string; wake: number } | undefined {
    const row = [...this.storage.sql.exec('SELECT thread,wake FROM ranking_jobs ORDER BY wake LIMIT 1')][0];
    return row ? { thread: String(row.thread), wake: Number(row.wake) } : undefined;
  }
  budget(): Budget {
    if (!this.#budget) {
      const row = [...this.storage.sql.exec('SELECT value FROM ranking_budget WHERE id=1')][0];
      this.#budget = row ? JSON.parse(String(row.value)) as Budget : { day: 0, hour: 0, reads: 0, writes: 0, requests: 0, invalidatedAt: 0, blockedUntil: 0 };
    }
    const day = Math.floor(this.now() / DAY), hour = Math.floor(this.now() / HOUR);
    if (this.#budget.day !== day) this.#budget = { ...this.#budget, day, reads: 0, writes: 0 };
    if (this.#budget.hour !== hour) this.#budget = { ...this.#budget, hour, requests: 0 };
    return this.#budget;
  }
  #saveBudget(): void {
    this.storage.sql.exec('INSERT INTO ranking_budget(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(this.#budget));
  }
  /** Charges conservative bounds before doing work. Unused reservations stay charged. */
  reserve(cost: Cost, control = false): { accepted: true } | { accepted: false; retryAt: number } {
    for (const n of Object.values(cost)) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid ranking reservation.');
    const budget = this.budget(), reserve = control ? 0 : 32;
    const written = budget.writes + cost.writes + 1;
    // Existing-row UPSERTs and job-index maintenance can also read rows.
    const reads = budget.reads + cost.reads + cost.writes + 4;
    const daily = written > this.options.maxRowsWrittenPerDay - reserve || reads > this.options.maxRowsReadPerDay - reserve;
    const hourly = budget.requests + cost.requests > this.options.maxRequestsPerHour;
    if (daily || hourly) return { accepted: false, retryAt: Math.max(daily ? (budget.day + 1) * DAY : 0, hourly ? (budget.hour + 1) * HOUR : 0) };
    this.transaction(() => {
      this.#budget = { ...budget, writes: written, reads, requests: budget.requests + cost.requests };
      this.#saveBudget();
    });
    return { accepted: true };
  }
  /** One durable global fence covers further writes after the control reserve is spent. */
  invalidateAll(): void {
    const budget = this.budget();
    if (budget.blockedUntil > this.now()) return;
    this.#budget = { ...budget, invalidatedAt: this.now(), blockedUntil: (budget.day + 1) * DAY, writes: budget.writes + 1 };
    this.#saveBudget();
  }
  load(thread: string): Dataset {
    if (this.#cache?.thread === thread) return this.#cache.data;
    const data: Dataset = { groups: new Map(), locations: new Map(), bytes: 0 };
    for (const row of this.storage.sql.exec('SELECT number,generation,value FROM ranking_groups WHERE thread=? ORDER BY number', thread)) {
      const value = String(row.value); data.bytes += value.length * 2;
      if (data.bytes > 32 * 1024 * 1024) throw new Error('RANKING_SIZE');
      const group: Group = { number: Number(row.number), generation: Number(row.generation), records: JSON.parse(value) as Candidate[] };
      data.groups.set(group.number, group);
      for (const record of group.records) data.locations.set(record.id, group.number);
    }
    this.#cache = { thread, data };
    return data;
  }
  cached(thread: string): Dataset | undefined { return this.#cache?.thread === thread ? this.#cache.data : undefined; }
  #writeGroup(thread: string, group: Group, previous?: Group): void {
    const value = JSON.stringify(group.records);
    this.storage.sql.exec('INSERT INTO ranking_groups(thread,number,generation,value) VALUES(?,?,?,?) ON CONFLICT(thread,number) DO UPDATE SET generation=excluded.generation,value=excluded.value', thread, group.number, group.generation, value);
    const data = this.cached(thread);
    if (data) { data.bytes += (value.length - (previous ? JSON.stringify(previous.records).length : 0)) * 2; data.groups.set(group.number, group); }
  }
  estimate(thread: string, incoming: readonly Candidate[], deleted: readonly string[], startedRevision: number): Cost {
    const data = this.load(thread), groups = new Set<number>();
    let inserted = 0, removed = 0;
    for (const candidate of incoming) {
      const number = data.locations.get(candidate.id);
      if (number === undefined) { inserted++; continue; }
      const group = data.groups.get(number)!;
      if (group.generation <= startedRevision && JSON.stringify(group.records.find(record => record.id === candidate.id)) !== JSON.stringify(candidate)) groups.add(number);
    }
    for (const id of deleted) {
      const number = data.locations.get(id);
      if (number !== undefined && data.groups.get(number)!.generation <= startedRevision) { removed++; groups.add(number); }
    }
    return { reads: 0, writes: inserted + removed + groups.size + (inserted ? Math.ceil(inserted / GROUP_SIZE) + 1 : 0), requests: 0 };
  }
  candidate(thread: string, id: string): Candidate | undefined {
    const cached = this.cached(thread);
    if (cached) { const number = cached.locations.get(id); return number === undefined ? undefined : cached.groups.get(number)?.records.find(record => record.id === id); }
    const location = [...this.storage.sql.exec('SELECT number FROM ranking_locations WHERE thread=? AND id=?', thread, id)][0];
    if (!location) return;
    const row = [...this.storage.sql.exec('SELECT value FROM ranking_groups WHERE thread=? AND number=?', thread, Number(location.number))][0]!;
    return (JSON.parse(String(row.value)) as Candidate[]).find(record => record.id === id);
  }
  /** Caller reserves first. A read started before a local write cannot replace its group. */
  apply(thread: string, incoming: readonly Candidate[], deleted: readonly string[], startedRevision: number, mutationRevision?: number): { changed: boolean; conflicts: string[] } {
    const data = this.load(thread), changes = new Map<number, Group>(), conflicts: string[] = [];
    let last = -1; for (const number of data.groups.keys()) last = Math.max(last, number);
    const edit = (number: number) => {
      let group = changes.get(number);
      if (!group) { const current = data.groups.get(number); group = { number, generation: current?.generation ?? 0, records: current ? [...current.records] : [] }; changes.set(number, group); }
      return group;
    };
    this.transaction(() => {
      for (const candidate of incoming) {
        let number = data.locations.get(candidate.id);
        if (number !== undefined && data.groups.get(number)!.generation > startedRevision && mutationRevision === undefined) { conflicts.push(candidate.id); continue; }
        if (number === undefined) {
          if (last < 0 || (changes.get(last) ?? data.groups.get(last))!.records.length >= GROUP_SIZE) last++;
          number = last;
          const group = edit(number); group.records.push(candidate);
          data.locations.set(candidate.id, number);
          this.storage.sql.exec('INSERT INTO ranking_locations(thread,id,number) VALUES(?,?,?)', thread, candidate.id, number);
        } else {
          const current = changes.get(number) ?? data.groups.get(number)!;
          const index = current.records.findIndex(record => record.id === candidate.id);
          if (JSON.stringify(current.records[index]) === JSON.stringify(candidate) && mutationRevision === undefined) continue;
          edit(number).records[index] = candidate;
        }
        if (mutationRevision !== undefined) edit(number).generation = mutationRevision;
      }
      for (const id of deleted) {
        const number = data.locations.get(id);
        if (number === undefined) continue;
        if (data.groups.get(number)!.generation > startedRevision && mutationRevision === undefined) { conflicts.push(id); continue; }
        const group = edit(number); group.records = group.records.filter(record => record.id !== id);
        if (mutationRevision !== undefined) group.generation = mutationRevision;
        data.locations.delete(id);
        this.storage.sql.exec('DELETE FROM ranking_locations WHERE thread=? AND id=?', thread, id);
      }
      for (const group of changes.values()) this.#writeGroup(thread, group, data.groups.get(group.number));
    });
    return { changed: changes.size > 0, conflicts };
  }
  /** Targeted own-write update does not restore a large dataset on a cold object. */
  mutate(thread: string, candidate: Candidate | { id: string; deleted: true }, revision: number): boolean {
    if (this.cached(thread)) return this.apply(thread, 'deleted' in candidate ? [] : [candidate], 'deleted' in candidate ? [candidate.id] : [], revision, revision).changed;
    const location = [...this.storage.sql.exec('SELECT number FROM ranking_locations WHERE thread=? AND id=?', thread, candidate.id)][0];
    if (!location) return false;
    const row = [...this.storage.sql.exec('SELECT generation,value FROM ranking_groups WHERE thread=? AND number=?', thread, Number(location.number))][0]!;
    const previous: Group = { number: Number(location.number), generation: Number(row.generation), records: JSON.parse(String(row.value)) as Candidate[] };
    const records = 'deleted' in candidate ? previous.records.filter(item => item.id !== candidate.id) : previous.records.map(item => item.id === candidate.id ? candidate : item);
    
    this.transaction(() => {
      this.#writeGroup(thread, { ...previous, generation: revision, records }, previous);
      if ('deleted' in candidate) this.storage.sql.exec('DELETE FROM ranking_locations WHERE thread=? AND id=?', thread, candidate.id);
    });
    return true;
  }
  appendScan(thread: string, page: number, ids: readonly string[]): void {
    this.storage.sql.exec('INSERT INTO ranking_scan(thread,page,value) VALUES(?,?,?) ON CONFLICT(thread,page) DO UPDATE SET value=excluded.value', thread, page, JSON.stringify(ids));
  }
  scanIds(thread: string): Set<string> {
    const ids = new Set<string>();
    for (const row of this.storage.sql.exec('SELECT value FROM ranking_scan WHERE thread=? ORDER BY page', thread)) for (const id of JSON.parse(String(row.value)) as string[]) ids.add(id);
    return ids;
  }
  clearScan(thread: string): void { this.storage.sql.exec('DELETE FROM ranking_scan WHERE thread=?', thread); }
}
