/** Ranking is operator configuration. A client selects a name, never a formula. */
export const INPUTS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES', 'replies', 'upvotes', 'answer'] as const;
export type Input = typeof INPUTS[number];
export interface Profile { weights: Partial<Record<Input, number>>; tieBreak: 'oldest' | 'newest' }
export interface RankingOptions {
  profiles: Record<string, Profile>;
  maxAgeSeconds: number;
  maxRequestsPerHour: number;
  maxRowsWrittenPerDay: number;
  maxRowsReadPerDay: number;
  /** Bound the complete opaque-ID response; an oversized order is never truncated. */
  maxOrderBytes: number;
}
export interface Candidate { id: string; created: number; eligible: boolean; values: Partial<Record<Input, number>> }
export interface DiscoveryPage {
  candidates: Candidate[];
  /** Newest-first pagination, at most 100 roots. Null means the complete end. */
  cursor: string | null;
  /** Incomplete/errored connection pages must be retried, not treated as the end. */
  complete: boolean;
}
export interface ObservationBatch {
  candidates: Candidate[];
  /** Only an error-free null or explicitly verified deletion belongs here. */
  deleted: string[];
  /** Failed IDs remain unresolved. Omission is also treated as unresolved. */
  unresolved?: string[];
}
export interface Source {
  discover(cursor: string | null, inputs: readonly Input[]): Promise<DiscoveryPage>;
  observe(ids: readonly string[], inputs: readonly Input[]): Promise<ObservationBatch>;
}
export interface SourceFailure extends Error { retryAt?: number; retryAfter?: number; code?: string }
export type OrderResult =
  | { status: 'ready'; ids: string[]; observedAt: number; revision: number }
  | { status: 'preparing'; retryAt: number }
  | { status: 'paused'; reason: 'budget' | 'upstream' | 'freshness' | 'size' | 'inputs'; retryAt: number | null };
export interface Sql { exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>> }
export interface Storage { sql: Sql; transactionSync<T>(action: () => T): T }
export const DEFAULT_RANKING_LIMITS = Object.freeze({ maxAgeSeconds: 600, maxRequestsPerHour: 240, maxRowsWrittenPerDay: 25_000, maxRowsReadPerDay: 500_000, maxOrderBytes: 8 * 1024 * 1024 });

export function validateOptions(options: RankingOptions): RankingOptions {
  const integer = (n: number, low: number, high: number) => Number.isSafeInteger(n) && n >= low && n <= high;
  const names = Object.keys(options.profiles);
  if (!names.length || names.length > 8) throw new Error('Ranking requires between one and eight named profiles.');
  for (const [name, profile] of Object.entries(options.profiles)) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || !['oldest', 'newest'].includes(profile.tieBreak)) throw new Error('Invalid ranking profile.');
    const weights = Object.entries(profile.weights);
    if (!weights.length || weights.some(([key, weight]) => !INPUTS.includes(key as Input) || typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 1_000_000)) throw new Error('Ranking weights must be finite, bounded numbers over supported inputs.');
    if (weights.every(([, weight]) => weight === 0)) throw new Error('A ranking profile needs a nonzero weight.');
  }
  if (!integer(options.maxAgeSeconds, 1, 604800) || !integer(options.maxRequestsPerHour, 1, 1000000) || !integer(options.maxRowsWrittenPerDay, 256, Number.MAX_SAFE_INTEGER) || !integer(options.maxRowsReadPerDay, 256, Number.MAX_SAFE_INTEGER) || !integer(options.maxOrderBytes, 1024, 32 * 1024 * 1024)) throw new Error('Invalid ranking allowance.');
  return structuredClone(options);
}
export function requiredInputs(profiles: Record<string, Profile>): Input[] {
  return INPUTS.filter(input => Object.values(profiles).some(profile => (profile.weights[input] ?? 0) !== 0));
}
export function validCandidate(candidate: Candidate, required: readonly Input[]): boolean {
  return typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 200 && Number.isSafeInteger(candidate.created) && candidate.created >= 0 && typeof candidate.eligible === 'boolean' && required.every(key => Number.isSafeInteger(candidate.values[key]) && candidate.values[key]! >= 0);
}
