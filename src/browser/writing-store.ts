import { recoveredWriting, type SavedWriting } from '../conversation/writing.js';

export interface WritingStore {
  load(scope: string): SavedWriting[];
  acquire(scope: string, id: string, lifetime: AbortSignal): Promise<boolean>;
  save(scope: string, writing: SavedWriting): void;
  remove(scope: string, id: string): void;
}
export interface WritingRecovery { retentionMs?: number; store?: WritingStore }

/** Each intent has its own durable record. Admission protects one record, never the discussion. */
export function browserWritingStore(
  retentionMs = 300_000,
  storage: () => Storage = () => localStorage,
  now = Date.now,
): WritingStore {
  if (!Number.isInteger(retentionMs) || retentionMs < 1 || retentionMs > 30 * 86_400_000)
    throw new RangeError('Writing retention must be between 1ms and 30 days.');
  const claims = new WeakMap<AbortSignal, Map<string, Promise<boolean>>>();
  const prefix = (scope: string) => scope + ':record:';
  return {
    load(scope) {
      const writing: SavedWriting[] = [];
      try {
        const store = storage(), keys = Array.from({ length: store.length }, (_, index) => store.key(index))
          .filter((key): key is string => Boolean(key?.startsWith(prefix(scope))));
        for (const key of keys) {
          let entry;
          try { entry = JSON.parse(store.getItem(key) || 'null'); } catch {}
          if (!entry || !(entry.expires === null || Number.isFinite(entry.expires) && entry.expires > now())) { store.removeItem(key);continue; }
          const saved = recoveredWriting([entry.writing])[0];
          if (saved && key === prefix(scope) + saved.id) writing.push(saved);
        }
      } catch { /* Existing in-memory writing remains available when storage is unavailable. */ }
      return writing;
    },
    acquire(scope, id, lifetime) {
      if (lifetime.aborted) return Promise.resolve(false);
      let owned = claims.get(lifetime);
      if (!owned) claims.set(lifetime, owned = new Map());
      const key = prefix(scope) + id;
      const previous = owned.get(key);
      if (previous) return previous;
      const work = new Promise<boolean>((resolve, reject) => {
        if (!navigator.locks) { reject(new Error('This browser cannot safely restore writing opened in another window.'));return; }
        void navigator.locks.request(key, { ifAvailable: true }, lock => {
          if (!lock || lifetime.aborted) { resolve(false);return; }
          resolve(true);
          return new Promise<void>(release => lifetime.addEventListener('abort', () => release(), { once: true }));
        }).catch(reject);
      });
      owned.set(key, work);
      work.then(acquired => { if (!acquired) owned!.delete(key); }, () => owned!.delete(key));
      return work;
    },
    save(scope, writing) {
      storage().setItem(prefix(scope) + writing.id, JSON.stringify({ expires: writing.issued ? null : now() + retentionMs, writing }));
    },
    remove(scope, id) { storage().removeItem(prefix(scope) + id); },
  };
}
