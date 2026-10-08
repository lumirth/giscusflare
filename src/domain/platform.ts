/** Cloudflare APIs used by the repository code. */
export interface SqlStorage { exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>> }
export interface DurableState {
  storage: { sql: SqlStorage; getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void> };
}
