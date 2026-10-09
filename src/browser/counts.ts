import type { CountObservation } from '../contracts/document.js';
import { batchRequests, type BatchRequest } from './batch.js';
import { countKey, type CountTarget } from '../contracts/count.js';
export { countKey, type CountTarget } from '../contracts/count.js';
export type { CountObservation } from '../contracts/document.js';
export interface CountsOptions {
  service: string; repo: string; origin: string; registration?: string;
  /** Optional same-tab retention. Null disables storage. */
  storage?: Storage | null;
}
export interface Counts {
  subscribe(target: string | CountTarget, listener: (observation: CountObservation) => void): () => void;
  read(targets: readonly (string | CountTarget)[], signal?: AbortSignal): Promise<void>;
  observe(observation: CountObservation): void;
  /** Preserve the last displayed fact; acquire and return the current authoritative count. */
  invalidate(value: {target: CountTarget; observedAt: number}): Promise<CountObservation | undefined>;
  dispose(): void;
}
type Acquisition = { key:string; entry:Entry; generation:number; fresh:boolean };
type Request = BatchRequest<Acquisition,void>;
type Entry = { target:CountTarget; value?: CountObservation; generation: number; stale: boolean; invalidatedAt?: number; listeners: Set<(value: CountObservation) => void>; request?: Request };
const retention = 3_600_000, maximum = 200, registries = new Set<Registry>();
const pageTarget = (key:string):CountTarget => ({selector:{kind:'page',key},window:{kind:'roots'}});
const validTarget = (value:unknown):value is CountTarget => {
  const target = value as CountTarget | null, selector = target?.selector, window = target?.window;
  return Boolean(selector && (selector.kind === 'page' ? typeof selector.key === 'string' && selector.key.trim() :
    selector.kind === 'discussion' && Number.isSafeInteger(selector.number) && selector.number > 0 && (selector.id === undefined || typeof selector.id === 'string')) &&
    window && (window.kind === 'roots' || window.kind === 'replies' && typeof window.parentId === 'string' && window.parentId));
};
const valid = (value: unknown): value is CountObservation => {
  if (!value || typeof value !== 'object') return false;
  const o = value as CountObservation;
  return validTarget(o.target) && Number.isSafeInteger(o.count) && o.count >= 0 &&
    Number.isFinite(o.observedAt) && Number.isFinite(o.expiresAt) && o.observedAt >= 0 && o.expiresAt >= o.observedAt &&
    (o.discussion === null || Boolean(o.discussion && typeof o.discussion.id === 'string' &&
      Number.isSafeInteger(o.discussion.number) && o.discussion.number > 0));
};
/** Each target owns its fact, consumers, validity and acquisition together. */
class Registry {
  readonly entries = new Map<string, Entry>();
  readonly lifetime = new AbortController();
  users = 0;
  readonly acquire = batchRequests<Acquisition,void>({group: input=>input.fresh, run:(inputs,signal)=>this.fetch(inputs,signal)});
  #snapshot: string | null = null;
  constructor(readonly options: CountsOptions, readonly identity: string, readonly storage: Storage | null) {
    if (typeof window !== 'undefined') window.addEventListener('pageshow', event => {
      if (event.persisted) { this.restore(); void this.read([...this.entries.values()].filter(entry => entry.listeners.size).map(entry => entry.target)).catch(() => {}); }
    }, { signal: this.lifetime.signal });
    this.restore();
  }
  release(): void {
    if (--this.users) return;
    registries.delete(this); this.lifetime.abort();
    this.entries.clear(); this.#snapshot = null;
  }
  entry(target: CountTarget): Entry {
    const key = countKey(target); let entry = this.entries.get(key);
    if (!entry) this.entries.set(key, entry = {target:{selector:{...target.selector},window:{...target.window}},generation:0,stale:false,listeners:new Set()});
    return entry;
  }
  restore(): void {
    try {
      const raw = this.storage?.getItem('giscusflare:counts:' + this.identity) ?? null;
      if (raw === this.#snapshot) return;
      this.#snapshot = raw;
      const values: unknown = JSON.parse(raw || '[]');
      if (Array.isArray(values)) for (const value of values.slice(-maximum)) {
        if (valid(value)) this.accept(value, false);
        else if (validTarget(value?.target) && Number.isFinite(value.invalidatedAt) && Date.now()-value.invalidatedAt < retention)
          this.markStale({target:value.target,observedAt:value.invalidatedAt}, false);
      }
    } catch { /* Retention does not determine availability. */ }
  }
  accept(value: CountObservation, persist = true): boolean {
    if (!valid(value) || Date.now() - value.observedAt >= retention) return false;
    const entry = this.entry(value.target), previous = entry.value;
    if (value.observedAt < (entry.invalidatedAt ?? 0) || previous && previous.observedAt > value.observedAt) return false;
    if (previous && previous.observedAt === value.observedAt && previous.expiresAt === value.expiresAt && previous.count === value.count &&
      previous.discussion?.id === value.discussion?.id && previous.discussion?.number === value.discussion?.number) return false;
    entry.generation++; entry.stale = false;
    entry.value = Object.freeze({...value,target:Object.freeze({selector:Object.freeze({...value.target.selector}),window:Object.freeze({...value.target.window})}),
      discussion:value.discussion && Object.freeze({id:value.discussion.id,number:value.discussion.number})});
    if (entry.request && !entry.request.dispatched) { entry.request.finish({value:undefined}); }
    const key = countKey(value.target); this.entries.delete(key); this.entries.set(key, entry);
    this.prune();
    if (persist) this.save();
    for (const listener of entry.listeners) try { listener(entry.value); } catch (error) { console.error('A count subscriber failed.', error); }
    return true;
  }
  prune(): void {
    for (const [key, entry] of this.entries) if (!entry.listeners.size && !entry.request &&
      (this.entries.size > maximum || Date.now() - (entry.value?.observedAt ?? entry.invalidatedAt ?? 0) >= retention)) this.entries.delete(key);
  }
  save(): void {
    if (!this.storage) return;
    try {
      this.#snapshot = JSON.stringify([...this.entries.values()].flatMap<CountObservation | {target:CountTarget;invalidatedAt:number}>(entry => entry.stale && entry.invalidatedAt !== undefined
        ? [{target:entry.target,invalidatedAt:entry.invalidatedAt}] : entry.value ? [entry.value] : []).slice(-maximum));
      this.storage?.setItem('giscusflare:counts:' + this.identity, this.#snapshot);
    } catch { /* Keep acquired facts when storage is unavailable. */ }
  }
  markStale({target,observedAt}: {target:CountTarget;observedAt:number}, persist = true): boolean {
    const entry = this.entry(target);
    if (!Number.isFinite(observedAt) || observedAt < 0 || (entry.value?.observedAt ?? 0) > observedAt || (entry.invalidatedAt ?? 0) > observedAt ||
      !persist && entry.stale && entry.invalidatedAt === observedAt) return false;
    entry.invalidatedAt = observedAt; entry.stale = true; entry.generation++;
    if (entry.request && !entry.request.dispatched) entry.request.finish({value:undefined});
    if (persist) this.save();
    return true;
  }
  invalidate(value:{target:CountTarget;observedAt:number}):Promise<CountObservation|undefined> {
    if (!this.markStale(value)) return Promise.resolve(this.entry(value.target).value);
    return this.read([value.target]).then(() => this.entry(value.target).value);
  }
  read(targets: readonly CountTarget[]): Promise<void> {
    this.restore();
    const requests: Promise<void>[] = [];
    for (const target of targets) {
      const entry = this.entry(target);
      if (!entry.stale && entry.value && entry.value.expiresAt > Date.now() && Date.now() - entry.value.observedAt < retention) continue;
      if (!entry.request || entry.request.input.generation !== entry.generation)
        entry.request = this.acquire(JSON.stringify([countKey(target),entry.generation,entry.stale]), {key:countKey(target),entry,generation:entry.generation,fresh:entry.stale});
      const request=entry.request;
      requests.push(request.wait(this.lifetime.signal).finally(()=> {if(entry.request===request)entry.request=undefined;this.prune();}));
    }
    return Promise.all(requests).then(() => {});
  }
  async fetch(batch:Acquisition[],signal:AbortSignal) {
    const { service, repo, origin, registration } = this.options;
    const input = {repo,origin,targets:batch.map(item => item.entry.target),...(registration ? {registration} : {}),...(batch[0]!.fresh ? {fresh:true} : {})};
    const body = JSON.stringify(input), url = service + '/api/v6/counts?' + new URLSearchParams({input:body});
    const response=await fetch(url.length <= 8192 ? url : service + '/api/v6/counts', {credentials:'omit',signal,
      ...(url.length > 8192 ? {method:'POST',headers:{'Content-Type':'text/plain'},body} : {})});
    if (!response.ok) throw new Error('Comment counts could not load.');
    const data: {observations?:Record<string,unknown>;errors?:Record<string,{message?:string}>} = await response.json();
    let changed = false;
    const results=batch.map(({key,entry,generation})=> {
      const value=data.observations?.[key];
      if(!valid(value)||countKey(value.target)!==key)return {error:new Error(data.errors?.[key]?.message || 'The comments service returned an invalid count observation.')};
      if(entry.generation===generation) {
        changed=this.accept(value,false)||changed;
        if(entry.stale&&value.observedAt>=(entry.invalidatedAt??0)){entry.stale=false;changed=true;}
      }
      return {value:undefined};
    });
    if(changed)this.save();
    return results;
  }

}
/** Scoped handles reuse one capability and release its memory and work after the last owner leaves. */
export function createCounts(options: CountsOptions): Counts {
  const service = new URL(options.service);
  if (service.origin !== options.service || !['https:', 'http:'].includes(service.protocol) ||
      service.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(service.hostname)) throw new TypeError('Use an HTTPS comments service origin.');
  if (new URL(options.origin).origin !== options.origin) throw new TypeError('Counts need a website origin.');
  let storage: Storage | null;
  try { storage = options.storage === undefined ? globalThis.sessionStorage ?? null : options.storage; } catch { storage = null; }
  const identity = JSON.stringify([options.service,options.repo,options.origin,options.registration ?? null]);
  const registry = [...registries].find(r => r.identity === identity && r.storage === storage) || new Registry({...options}, identity, storage);
  registries.add(registry); registry.users++;
  const subscriptions = new Set<() => void>(); let disposed = false;
  return {
    subscribe(target, listener) {
      if (disposed) throw new Error('Counts have been disposed.');
      const selected = typeof target === 'string' ? pageTarget(target) : target;
      const entry = registry.entry(selected), emit = (value:CountObservation) => listener(value); entry.listeners.add(emit);
      const release = () => { entry.listeners.delete(emit); subscriptions.delete(release); registry.prune(); };
      subscriptions.add(release);
      if (entry.value && Date.now() - entry.value.observedAt < retention) try {emit(entry.value);} catch(error) {console.error('A count subscriber failed.',error);}
      void registry.read([selected]).catch(() => {}); return release;
    },
    read(targets, signal) {
      if (disposed) return Promise.reject(new Error('Counts have been disposed.'));
      const selected = targets.map(target => typeof target === 'string' ? pageTarget(target) : target);
      if (!signal) return registry.read(selected);
      signal.throwIfAborted();
      return new Promise<void>((resolve,reject) => {
        const aborted = () => reject(signal.reason); signal.addEventListener('abort',aborted,{once:true});
        registry.read(selected).then(resolve,reject).finally(() => signal.removeEventListener('abort',aborted));
      });
    },
    observe(value) { if (!disposed) registry.accept(value); },
    invalidate(value) { return disposed ? Promise.reject(new Error('Counts have been disposed.')) : registry.invalidate(value); },
    dispose() {
      if (disposed) return; disposed = true; for (const release of subscriptions) release();
      registry.release();
    },
  };
}
