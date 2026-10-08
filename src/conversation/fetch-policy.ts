/** Client freshness preferences. These never override server query/rate caps. */
export interface FetchPolicy {
  onFocus: boolean;
  onReconnect: boolean;
  staleAfterMs: number;
  replyPrefetch: number;
}
export const defaultFetchPolicy: Readonly<FetchPolicy> = Object.freeze({
  onFocus: true,
  onReconnect: true,
  staleAfterMs: 60_000,
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
  ] as const) {
    const n = policy[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
      throw new RangeError(
        `${key} must be an integer between ${min} and ${max}.`,
      );
  }
  return policy;
}
