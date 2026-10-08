import { INPUTS, type Candidate, type Fact, type Profile, type RankingOptions, type Storage } from './types.js';

const DAY = 86400000, HOUR = 3600000;
const columns = INPUTS.map((_, index) => 'v' + index);
const fields = ['created', 'eligible', ...columns];
interface Meter { day: number; hour: number; reads: number; writes: number; requests: number }
export interface Scored { id: string; score: number; created: number }

/** Typed observations and one checkpoint per collection; native SQL owns row accounting. */
export class RankingStore {
  #meter: Meter;
  #unpersisted = 0;
  #ready = false;
  constructor(readonly storage: Storage, readonly options: RankingOptions, readonly now: () => number) {
    this.#meter = { day: Math.floor(now() / DAY), hour: Math.floor(now() / HOUR), reads: 0, writes: 0, requests: 0 };
    this.exec(`CREATE TABLE IF NOT EXISTS ranking_items(thread TEXT,id TEXT,version INTEGER NOT NULL,seen INTEGER NOT NULL,removed INTEGER NOT NULL,created INTEGER,eligible INTEGER,${columns.map(c => c + ' INTEGER').join(',')},PRIMARY KEY(thread,id)) WITHOUT ROWID`);
    this.exec('CREATE INDEX IF NOT EXISTS ranking_members ON ranking_items(thread,seen,id)');
    this.exec('CREATE TABLE IF NOT EXISTS ranking_state(thread TEXT PRIMARY KEY,value TEXT NOT NULL,wake INTEGER) WITHOUT ROWID');
    this.exec('CREATE INDEX IF NOT EXISTS ranking_due ON ranking_state(wake) WHERE wake IS NOT NULL');
    this.exec('CREATE TABLE IF NOT EXISTS ranking_meter(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)');
    const row = this.exec('SELECT value FROM ranking_meter WHERE id=1')[0];
    if (row) {
      const previous = JSON.parse(String(row.value)) as Meter;
      if (previous.day === this.#meter.day) { this.#meter.reads += previous.reads; this.#meter.writes += previous.writes; }
      if (previous.hour === this.#meter.hour) this.#meter.requests = previous.requests;
    }
    this.#ready = true;
    this.checkpoint();
  }
  #read<T>(query: string, bindings: (string | number | null)[], read: (cursor: ReturnType<Storage['sql']['exec']>) => T): T {
    this.usage();
    const cursor = this.storage.sql.exec(query, ...bindings);
    try { return read(cursor); }
    finally {
      this.#meter.reads += cursor.rowsRead; this.#meter.writes += cursor.rowsWritten;
      this.#unpersisted += cursor.rowsRead + cursor.rowsWritten;
      if (this.#ready && this.#unpersisted >= 100) this.checkpoint();
    }
  }
  exec(query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] {
    return this.#read(query, bindings, cursor => [...cursor]);
  }
  usage(): Meter {
    const day = Math.floor(this.now() / DAY), hour = Math.floor(this.now() / HOUR);
    if (this.#meter.day !== day) this.#meter = { ...this.#meter, day, reads: 0, writes: 0 };
    if (this.#meter.hour !== hour) this.#meter = { ...this.#meter, hour, requests: 0 };
    return this.#meter;
  }
  checkpoint(): void {
    // Quiet reads flush every100 rows; scan steps and HTTP admission checkpoint explicitly.
    // A crash may omit at most an interrupted bounded step plus the unflushed tail.
    this.#unpersisted = 0;
    this.exec('INSERT INTO ranking_meter VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(this.usage()));
  }
  blocked(requests = 0): number | null {
    const usage = this.usage();
    return Math.max(
      usage.reads >= this.options.maxRowsReadPerDay || usage.writes >= this.options.maxRowsWrittenPerDay ? (usage.day + 1) * DAY : 0,
      usage.requests + requests > this.options.maxRequestsPerHour ? (usage.hour + 1) * HOUR : 0,
    ) || null;
  }
  request(count = 1): number | null {
    const blocked = this.blocked(count);
    if (!blocked) { this.#meter.requests += count; this.checkpoint(); }
    return blocked;
  }
  get<T>(thread: string): T | undefined {
    const row = this.exec('SELECT value FROM ranking_state WHERE thread=?', thread)[0];
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  save(thread: string, value: unknown, wake: number | null): void {
    this.exec('INSERT INTO ranking_state VALUES(?,?,?) ON CONFLICT(thread) DO UPDATE SET value=excluded.value,wake=excluded.wake', thread, JSON.stringify(value), wake);
    this.checkpoint();
  }
  next(): { thread: string; wake: number } | undefined {
    const row = this.exec('SELECT thread,wake FROM ranking_state WHERE wake IS NOT NULL ORDER BY wake LIMIT 1')[0];
    return row ? { thread: String(row.thread), wake: Number(row.wake) } : undefined;
  }
  ids(thread: string, after: string, limit: number): string[] {
    return this.exec('SELECT id FROM ranking_items WHERE thread=? AND id>? AND removed=0 ORDER BY id LIMIT ?', thread, after, limit).map(row => String(row.id));
  }
  /** Local fact versions protect returning remote responses; unchanged inputs write no row. */
  apply(thread: string, candidates: readonly (Candidate | null)[], ids: readonly string[], version: number, seen?: number): boolean {
    let changed = false;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate) {
        changed = this.exec('UPDATE ranking_items SET removed=1,seen=0 WHERE thread=? AND id=? AND version<=? AND removed=0 RETURNING id', thread, ids[index]!, version).length > 0 || changed;
        continue;
      }
      const values = [candidate.created, Number(candidate.eligible), ...INPUTS.map(input => candidate.values[input] ?? null)];
      const updates = fields.map(field => `${field}=CASE WHEN ranking_items.version<=? THEN COALESCE(excluded.${field},ranking_items.${field}) ELSE ranking_items.${field} END`).join(',');
      const difference = fields.map(field => `(excluded.${field} IS NOT NULL AND ranking_items.${field} IS NOT excluded.${field})`).join(' OR ');
      const result = this.exec(`INSERT INTO ranking_items(thread,id,version,seen,removed,${fields.join(',')}) VALUES(${Array(fields.length + 5).fill('?').join(',')}) ON CONFLICT(thread,id) DO UPDATE SET seen=${seen === undefined ? 'ranking_items.seen' : 'excluded.seen'},removed=CASE WHEN ranking_items.version<=? THEN 0 ELSE ranking_items.removed END,${updates} WHERE ${seen === undefined ? '' : 'ranking_items.seen!=excluded.seen OR '}(ranking_items.version<=? AND (ranking_items.removed=1 OR ${difference})) RETURNING id`, thread, candidate.id, 0, seen ?? 0, 0, ...values, version, ...fields.map(() => version), version);
      changed = result.length > 0 || changed;
    }
    return changed;
  }
  prune(thread: string, seen: number, limit: number): number {
    return this.exec('DELETE FROM ranking_items WHERE (thread,id) IN (SELECT thread,id FROM ranking_items WHERE thread=? AND seen<? ORDER BY seen LIMIT ?) RETURNING id', thread, seen, limit).length;
  }
  correct(thread: string, fact: Fact, version: number, seen: number): void {
    if ('removed' in fact) {
      this.exec('INSERT INTO ranking_items(thread,id,version,seen,removed) VALUES(?,?,?,0,1) ON CONFLICT(thread,id) DO UPDATE SET version=excluded.version,seen=0,removed=1', thread, fact.id, version);
      return;
    }
    this.exec(`INSERT INTO ranking_items(thread,id,version,seen,removed,${fields.join(',')}) VALUES(${Array(fields.length + 5).fill('?').join(',')}) ON CONFLICT(thread,id) DO UPDATE SET version=excluded.version,seen=excluded.seen,removed=0,${fields.map(field => `${field}=excluded.${field}`).join(',')}`, thread, fact.id, version, seen, 0, fact.created, Number(fact.eligible), ...INPUTS.map(input => fact.values[input] ?? null));
  }
  order(thread: string, profile: Profile, id?: string): Scored[] {
    const weights = Object.entries(profile.weights).filter(([, weight]) => weight !== 0);
    const score = weights.map(([input]) => `CAST(${columns[INPUTS.indexOf(input as typeof INPUTS[number])]} AS REAL)*?`).join('+');
    return this.#read(`SELECT id,created,(${score}) AS score FROM ranking_items WHERE thread=? AND removed=0 AND eligible=1 ${id ? 'AND id=?' : ''} ORDER BY score DESC,created ${profile.tieBreak === 'oldest' ? 'ASC' : 'DESC'},id`, [...weights.map(([, weight]) => weight), thread, ...(id ? [id] : [])], cursor => {
      const result: Scored[] = [];
      let bytes = 2, retained = 0;
      for (const row of cursor) {
        const item = { id: String(row.id), created: Number(row.created), score: Number(row.score) };
        bytes += item.id.length + 2 + (result.length ? 1 : 0);
        retained += item.id.length * 2 + 88;
        if (!id && (bytes > this.options.maxOrderBytes || retained > 32 * 1024 * 1024)) throw Error('RANKING_SIZE');
        result.push(item);
      }
      return result;
    });
  }
}
