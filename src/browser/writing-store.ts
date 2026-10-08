export interface WritingStore {
  load(key: string): string | null;
  save(key: string, value: string, protectedWriting?: boolean): void;
  remove(key: string): void;
}
export interface WritingRecovery {
  retentionMs?: number;
  store?: WritingStore;
}
/** Ordinary writing expires; unresolved issued work remains recoverable until explicitly cleared. */
export function browserWritingStore(
  retentionMs = 300_000,
  storage: () => Storage = () => localStorage,
  now = Date.now,
): WritingStore {
  if (
    !Number.isInteger(retentionMs) ||
    retentionMs < 1 ||
    retentionMs > 30 * 86_400_000
  )
    throw new RangeError("Writing retention must be between 1ms and 30 days.");
  return {
    load(key) {
      try {
        const entry = JSON.parse(storage().getItem(key) || "null");
        if (
          entry &&
          typeof entry.value === "string" &&
          entry.value.length <= 240000 &&
          (entry.expires === null || Number.isFinite(entry.expires) &&
          entry.expires > now() &&
          entry.expires <= now() + retentionMs)
        )
          return entry.value;
        storage().removeItem(key);
      } catch {}
      return null;
    },
    save(key, value, protectedWriting = false) {
      if (value.length > 240000) return;
      try {
        storage().setItem(
          key,
          JSON.stringify({ expires: protectedWriting ? null : now() + retentionMs, value }),
        );
      } catch {
        /* In-memory writing continues when storage is unavailable. */
      }
    },
    remove(key) {
      try {
        storage().removeItem(key);
      } catch {}
    },
  };
}
