export interface DraftStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}
export interface DraftRecovery {
  retentionMs?: number;
  store?: DraftStore;
}
/** Recovery is optional and outside the model. Expired writing is never restored. */
export function browserDraftStore(
  retentionMs = 300_000,
  storage: () => Storage = () => localStorage,
  now = Date.now,
): DraftStore {
  if (
    !Number.isInteger(retentionMs) ||
    retentionMs < 1 ||
    retentionMs > 30 * 86_400_000
  )
    throw new RangeError("Draft retention must be between 1ms and 30 days.");
  return {
    load(key) {
      try {
        const entry = JSON.parse(storage().getItem(key) || "null");
        if (
          entry &&
          typeof entry.value === "string" &&
          entry.value.length <= 240000 &&
          Number.isFinite(entry.expires) &&
          entry.expires > now() &&
          entry.expires <= now() + retentionMs
        )
          return entry.value;
        storage().removeItem(key);
      } catch {}
      return null;
    },
    save(key, value) {
      if (value.length > 240000) return;
      try {
        storage().setItem(
          key,
          JSON.stringify({ expires: now() + retentionMs, value }),
        );
      } catch {
        /* In-memory drafts continue when storage is unavailable. */
      }
    },
    remove(key) {
      try {
        storage().removeItem(key);
      } catch {}
    },
  };
}
