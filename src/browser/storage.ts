/** Shared host storage mechanics for native and iframe embeddings. */
const failedWrites = new WeakMap<Window, Map<string, unknown>>();
export function storageNamespace(service: string, repo: string): string {
  return `giscusflare:4:${service}:${repo}:`;
}
export function writingIdentity(config: {
  strict?: unknown;
  number?: unknown;
  term?: unknown;
}): string {
  return (
    "writing:" +
    JSON.stringify([
      Boolean(config.strict),
      Number(config.number) || 0,
      config.term || "",
    ])
  );
}
export function scopedStorage(prefix: string) {
  let memory = failedWrites.get(window);
  if (!memory) failedWrites.set(window, memory = new Map());
  return {
    forget(key: string) { memory.delete(prefix + key); },
    read(key: string, persistent = false): unknown {
      if (memory.has(prefix + key)) return memory.get(prefix + key);
      try {
        return JSON.parse(
          (persistent ? localStorage : sessionStorage).getItem(prefix + key) ||
            "null",
        );
      } catch {
        return null;
      }
    },
    write(key: string, value: unknown, persistent = false): void {
      try {
        const store = persistent ? localStorage : sessionStorage;
        value === null
          ? store.removeItem(prefix + key)
          : store.setItem(prefix + key, JSON.stringify(value));
        memory.delete(prefix + key);
      } catch {
        memory.set(prefix + key, value);
      }
    },
  };
}
