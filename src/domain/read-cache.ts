import type { ReadValue } from '../contracts/results.js';
import { AppError } from './errors.js';
import type { Store } from './store.js';
interface Observation extends ReadValue<unknown> { retained: number; group: string; alias: string | null }
/** One bounded, durable owner of public observations and their acquisitions. */
export class ReadCache {
  #pending = new Map<string, Promise<ReadValue<unknown>>>();
  #versions = new Map<string,number>();
  #pendingGroups = new Map<string,string>();
  #aliases=new Map<string,string>();
  constructor(readonly store: Store, readonly background: (work: Promise<unknown>) => void, readonly maximumBytes = 8 * 1024 * 1024) {
    store.sql.exec('CREATE TABLE IF NOT EXISTS public_reads (key TEXT PRIMARY KEY, group_key TEXT NOT NULL, alias TEXT, value TEXT NOT NULL, expires INTEGER NOT NULL, retained INTEGER NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL)');
    store.sql.exec('CREATE INDEX IF NOT EXISTS public_reads_group ON public_reads(group_key)');
    store.sql.exec('CREATE INDEX IF NOT EXISTS public_reads_alias ON public_reads(alias)');
    store.sql.exec('CREATE INDEX IF NOT EXISTS public_reads_age ON public_reads(touched,key)');
    store.sql.exec('CREATE INDEX IF NOT EXISTS public_reads_retention ON public_reads(retained)');
    store.sql.exec('CREATE TABLE IF NOT EXISTS public_read_budget (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL)');
    store.sql.exec('INSERT OR IGNORE INTO public_read_budget SELECT 1,COALESCE(SUM(bytes),0) FROM public_reads');
    store.sql.exec('CREATE TRIGGER IF NOT EXISTS public_read_insert AFTER INSERT ON public_reads BEGIN UPDATE public_read_budget SET bytes=bytes+NEW.bytes; END');
    store.sql.exec('CREATE TRIGGER IF NOT EXISTS public_read_update AFTER UPDATE OF bytes ON public_reads BEGIN UPDATE public_read_budget SET bytes=bytes+NEW.bytes-OLD.bytes; END');
    store.sql.exec('CREATE TRIGGER IF NOT EXISTS public_read_delete AFTER DELETE ON public_reads BEGIN UPDATE public_read_budget SET bytes=bytes-OLD.bytes; END');
  }
  #get(key: string): Observation | undefined {
    const row = [...this.store.sql.exec('SELECT * FROM public_reads WHERE key=? AND retained>?', key, this.store.now())][0];
    if (!row) return;
    return { value: JSON.parse(String(row.value)), expires: Number(row.expires), retained: Number(row.retained), group: String(row.group_key), alias: row.alias === null ? null : String(row.alias) };
  }
  #put(key: string, group: string, value: unknown, expires: number, retained: number, alias: string | null = null): void {
    const serialized = JSON.stringify(value), bytes = serialized.length * 2 + 256;
    if (bytes > this.maximumBytes) return;
    this.store.sql.exec('DELETE FROM public_reads WHERE retained<=?', this.store.now());
    this.store.sql.exec('INSERT INTO public_reads VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires,retained=excluded.retained,bytes=excluded.bytes,touched=excluded.touched,alias=COALESCE(excluded.alias,public_reads.alias)', key, group, alias, serialized, expires, retained, bytes, this.store.now());
    let total = Number([...this.store.sql.exec('SELECT bytes FROM public_read_budget WHERE id=1')][0]?.bytes ?? 0);
    for (const row of this.store.sql.exec('SELECT key,bytes FROM public_reads ORDER BY touched,key')) {
      if (total <= this.maximumBytes) break;
      this.store.sql.exec('DELETE FROM public_reads WHERE key=?', String(row.key)); total -= Number(row.bytes);
    }
  }
  identify(group: string, alias: string): void { this.#aliases.set(group,alias); this.store.sql.exec('UPDATE public_reads SET alias=? WHERE group_key=? AND alias IS NOT ?', alias, group, alias); }
  #rows(groups?:readonly string[]){
    const where=groups?.length?' WHERE group_key IN ('+groups.map(()=>'?').join(',')+') OR alias IN ('+groups.map(()=>'?').join(',')+')':'';
    return [...this.store.sql.exec('SELECT * FROM public_reads'+where,...(groups?[...groups,...groups]:[]))];
  }
  #advance(groups?:readonly string[]):void{
    const pending=new Set(this.#pendingGroups.values());
    const affected=new Set(this.#rows(groups).map(row=>String(row.group_key)).filter(group=>pending.has(group)));
    for(const group of this.#pendingGroups.values())if(!groups||groups.includes(group)||Boolean(this.#aliases.get(group)&&groups.includes(this.#aliases.get(group)!)))affected.add(group);
    for(const group of affected)this.#versions.set(group,(this.#versions.get(group)??0)+1);
  }
  dirty(groups?:readonly string[]):void{
    this.#advance(groups);
    for(const row of this.#rows(groups))this.store.sql.exec('UPDATE public_reads SET expires=0 WHERE key=?',String(row.key));
  }
  /** Withdraw known-invalid observations; an earlier acquisition cannot reinstall them. */
  invalidate(groups?:readonly string[]):void{
    this.#advance(groups);
    for(const row of this.#rows(groups))this.store.sql.exec('DELETE FROM public_reads WHERE key=?',String(row.key));
  }
  /** Confirmed facts update retained views without extending their acquisition age. */
  update(groups:readonly string[]|undefined,change:(value:unknown,key:string)=>unknown):void{
    this.#advance(groups);
    for(const row of this.#rows(groups)){
      const value=change(JSON.parse(String(row.value)),String(row.key));
      if(value===undefined)this.store.sql.exec('DELETE FROM public_reads WHERE key=?',String(row.key));
      else this.#put(String(row.key),String(row.group_key),value,Number(row.expires),Number(row.retained),row.alias===null?null:String(row.alias));
    }
  }
  seed(key: string, group: string, value: unknown, expires: number, retention: number, alias?: string): void { const existing=this.#get(key);if(existing&&Number((existing.value as {observedAt:number}).observedAt)>=Number((value as {observedAt:number}).observedAt))return;this.#put(key, group, value, expires, Math.max(expires, this.store.now() + retention), alias ?? null); }
  async read<T>(key: string, group: string, ttl: number, load: () => Promise<T>, options: { fresh?: boolean; retention?: number; accept?:(value:T)=>void } = {}): Promise<ReadValue<T>> {
    const cached = this.#get(key) as Observation & { value: T } | undefined;
    if (cached && !options.fresh && cached.expires > this.store.now()) return { value: cached.value, expires: cached.expires };
    let pending = this.#pending.get(key) as Promise<ReadValue<T>> | undefined;
    if (!pending) {
      const revision = this.#versions.get(group)??0;
      pending = Promise.resolve().then(load).then(value => {
        const observed = Number((value as { observedAt?: number })?.observedAt ?? this.store.now()), expires = observed + ttl;
        if (revision !== (this.#versions.get(group)??0)) {
          const current = this.#get(key);
          if (current) return { value: current.value as T, expires: current.expires };
          throw new AppError(503, 'UPSTREAM', 'The conversation changed while refreshing. Try again.', 1);
        }
        options.accept?.(value);
        if (ttl > 0) this.#put(key, group, value, expires, observed + Math.max(ttl, options.retention ?? 3600000), cached?.alias ?? this.#aliases.get(group) ?? null);
        console.info(JSON.stringify({ event: 'public_acquisition', group, outcome: 'updated', observedAt: observed }));
        return { value, expires };
      }).catch(error => {
        if (error instanceof AppError && (error.status === 429 || error.status >= 500) && error.code !== 'CONFIGURATION' && cached && cached.retained > this.store.now() && revision === (this.#versions.get(group)??0)) {
          console.info(JSON.stringify({ event: 'public_acquisition', group, outcome: 'retained', code: error.code }));
          return { value: cached.value, expires: cached.expires };
        }
        if (error instanceof AppError && [401, 403, 404].includes(error.status)) this.invalidate([group,...(cached?.alias?[cached.alias]:[])]);
        throw error;
      }).finally(() => { this.#pending.delete(key);this.#pendingGroups.delete(key);if(![...this.#pendingGroups.values()].includes(group)){this.#versions.delete(group);this.#aliases.delete(group);} });
      this.#pending.set(key, pending);this.#pendingGroups.set(key,group);
    }
    if (cached && !options.fresh) {
      this.background(pending.catch(error => console.warn(JSON.stringify({ event: 'public_refresh_failed', code: error instanceof AppError ? error.code : 'INTERNAL' }))));
      return { value: cached.value, expires: cached.expires };
    }
    return pending;
  }
}
