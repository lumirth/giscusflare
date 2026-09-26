/** Shared host storage mechanics for native and iframe embeddings. */
export function storageNamespace(service: string, repo: string): string {
  return `giscusflare:1:${service}:${repo}:`;
}
export function draftIdentity(config: {
  category?: unknown;
  categoryId?: unknown;
  strict?: unknown;
  number?: unknown;
  term?: unknown;
}): string {
  return (
    "draft:" +
    JSON.stringify([
      config.categoryId || config.category || "",
      Boolean(config.strict),
      Number(config.number) || 0,
      config.term || "",
    ])
  );
}
export function scopedStorage(prefix: string) {
  const memory = new Map<string, unknown>();
  return {
    read(key: string, persistent = false): unknown {
      try {
        return JSON.parse(
          (persistent ? localStorage : sessionStorage).getItem(prefix + key) ||
            "null",
        );
      } catch {
        return memory.get(key) || null;
      }
    },
    write(key: string, value: unknown, persistent = false): boolean {
      memory.set(key, value);
      try {
        const store = persistent ? localStorage : sessionStorage;
        value === null
          ? store.removeItem(prefix + key)
          : store.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}
