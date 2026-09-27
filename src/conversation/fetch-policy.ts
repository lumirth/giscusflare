/** Client freshness preferences. These never override server query/rate caps. */
export interface FetchPolicy {
  onFocus: boolean;
  onReconnect: boolean;
  staleAfterMs: number;
  pollIntervalMs: number | false;
  replyPrefetch: number;
}
export const defaultFetchPolicy: Readonly<FetchPolicy> = Object.freeze({
  onFocus: true,
  onReconnect: true,
  staleAfterMs: 60_000,
  pollIntervalMs: false,
  replyPrefetch: 5,
});
export function fetchPolicy(
  value: Partial<FetchPolicy> | false = {},
): FetchPolicy {
  const policy =
    value === false
      ? { ...defaultFetchPolicy, onFocus: false, onReconnect: false }
      : { ...defaultFetchPolicy, ...value };
  for (const key of ["onFocus", "onReconnect"] as const)
    if (typeof policy[key] !== "boolean")
      throw new TypeError(key + " must be boolean.");
  for (const [key, min, max] of [
    ["staleAfterMs", 0, 86_400_000],
    ["replyPrefetch", 0, 100],
    ["pollIntervalMs", 30_000, 86_400_000],
  ] as const) {
    const n = policy[key];
    if (key === "pollIntervalMs" && n === false) continue;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
      throw new RangeError(
        `${key} must be an integer between ${min} and ${max}.`,
      );
  }
  return policy;
}

/** One scheduler per conversation, independent of DOM and presentation. */
export class FetchScheduler {
  #pending = false;
  #failures = 0;
  #retryAt = 0;
  constructor(
    readonly policy: FetchPolicy,
    readonly refresh: () => Promise<boolean>,
    readonly lastRefresh: () => number,
    readonly available: () => boolean,
    readonly now = Date.now,
  ) {}
  async trigger(reason: "focus" | "reconnect" | "poll"): Promise<void> {
    if (
      (reason === "focus" && !this.policy.onFocus) ||
      (reason === "reconnect" && !this.policy.onReconnect) ||
      (reason === "poll" && this.policy.pollIntervalMs === false)
    )
      return;
    const time = this.now();
    if (
      this.#pending ||
      !this.available() ||
      time < this.#retryAt ||
      time - this.lastRefresh() < this.policy.staleAfterMs
    )
      return;
    this.#pending = true;
    let success = false;
    try {
      success = await this.refresh();
    } catch {
      /* Treat unexpected failures as unsuccessful reads for backoff. */
    } finally {
      this.#pending = false;
      this.#failures = success ? 0 : this.#failures + 1;
      this.#retryAt = success
        ? 0
        : this.now() +
          Math.min(300_000, 5_000 * 2 ** Math.min(this.#failures - 1, 6));
    }
  }
}
