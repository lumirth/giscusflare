import type { ReadValue } from '../contracts/results.js';
interface Read { group: string; alias?: string; bytes: number; promise: Promise<ReadValue<unknown>>; result?: ReadValue<unknown> }
/** Completed-value reuse and overlapping reads share one owner. */
export class ReadCache {
  #reads = new Map<string, Read>();
  #bytes = 0;
  constructor(readonly now: () => number = Date.now, readonly maximumBytes = 8 * 1024 * 1024) {}
  #remove(key: string): void {
    this.#bytes -= this.#reads.get(key)?.bytes ?? 0;
    this.#reads.delete(key);
  }
  identify(group: string, alias: string): void {
    for (const read of this.#reads.values()) if (read.group === group) read.alias = alias;
  }
  invalidate(matches: (group: string) => boolean): void {
    for (const [key, read] of this.#reads) if (matches(read.group) || (read.alias && matches(read.alias))) this.#remove(key);
  }
  async read<T>(key: string, group: string, ttl: number, load: () => Promise<T>): Promise<ReadValue<T>> {
    const cached = this.#reads.get(key);
    if (cached && (!cached.result || cached.result.expires > this.now())) {
      this.#reads.delete(key);
      this.#reads.set(key, cached);
      return cached.promise as Promise<ReadValue<T>>;
    }
    if (cached) this.#remove(key);
    const expires = this.now() + ttl;
    const read: Read = { group, bytes: 0, promise: Promise.resolve().then(load).then(value => {
      // Retained-value weight estimate; excludes object overhead and in-flight work.
      const bytes = (JSON.stringify(value).length + key.length + group.length) * 2 + 256;
      const entry = { value, expires };
      if (this.#reads.get(key) === read && ttl > 0 && expires > this.now() && bytes <= this.maximumBytes) {
        for (const [oldest, entry] of this.#reads) {
          if (this.#bytes + bytes <= this.maximumBytes) break;
          if (entry.result) this.#remove(oldest);
        }
        read.result = entry;
        read.bytes = bytes;
        this.#bytes += bytes;
        this.#reads.delete(key);
        this.#reads.set(key, read);
      }
      return entry;
    }).finally(() => { if (!read.result && this.#reads.get(key) === read) this.#remove(key); }) };
    this.#reads.set(key, read);
    return read.promise as Promise<ReadValue<T>>;
  }
}
