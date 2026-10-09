/** Shared host storage mechanics for native and iframe embeddings. */
const failedWrites = new WeakMap<Window, Map<string, unknown>>();
export function storageNamespace(service: string, repo: string): string {
  return `giscusflare:5:${service}:${repo}:`;
}
export function writingIdentity(config: Pick<import('./options.js').Page, 'origin' | 'selector'>): string {
  const selector = config.selector;
  return 'writing:' + JSON.stringify([config.origin, selector.kind === 'page', selector.kind === 'discussion' ? selector.number : 0, selector.kind === 'page' ? selector.key : '']);
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
