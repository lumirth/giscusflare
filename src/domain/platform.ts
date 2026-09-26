/** Cloudflare APIs used by the repository code. */
export interface SqlCursor<T extends Record<string, unknown>> extends Iterable<T> {}
export interface SqlStorage { exec<T extends Record<string, unknown> = Record<string, unknown>>(query: string, ...bindings: (string | number | null)[]): SqlCursor<T> }
export interface DurableState {
  storage: { sql: SqlStorage; getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void>; deleteAlarm(): Promise<void> };
}
export type FetchLike = (request: Request) => Promise<Response>;
