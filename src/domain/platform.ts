/** Cloudflare APIs used by the repository code. */
export interface SqlCursor<T extends Record<string, unknown>> extends Iterable<T> {}
export interface SqlStorage { exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>> }
export interface DurableState {
  storage: { sql: SqlStorage; getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void>; deleteAlarm(): Promise<void> };
}
export type FetchLike = (request: Request) => Promise<Response>;
