import * as v from 'valibot';
import type {Metadata,CountObservation} from '../contracts/document.js';

export const INPUTS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES', 'replies', 'upvotes', 'answer'] as const;
export type Input = typeof INPUTS[number];
export const Profile = v.strictObject({
  weights: v.pipe(v.record(v.picklist(INPUTS), v.pipe(v.number(), v.finite(), v.minValue(-1000000), v.maxValue(1000000))), v.check(weights => Object.values(weights).some(n => n !== 0))),
  tieBreak: v.picklist(['oldest', 'newest']),
});
export type Profile = v.InferOutput<typeof Profile>;
export const RankingOptions = v.strictObject({
  profiles: v.pipe(v.record(v.pipe(v.string(), v.regex(/^[a-z][a-z0-9_-]{0,31}$/)), Profile), v.check(p => Object.keys(p).length > 0 && Object.keys(p).length <= 8)),
  /** Time between completed acquisitions; source values may span the reported interval. */
  refreshSeconds: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(604800)),
  maxRequestsPerHour: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000000)),
  /** SQL thresholds checked between bounded scan steps, rather than prepaid reservations. */
  maxRowsWrittenPerDay: v.pipe(v.number(), v.safeInteger(), v.minValue(256)),
  maxRowsReadPerDay: v.pipe(v.number(), v.safeInteger(), v.minValue(256)),
  maxOrderBytes: v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(33554432)),
});
export type RankingOptions = v.InferOutput<typeof RankingOptions>;
export interface Candidate { id: string; created: number; eligible: boolean; values: Partial<Record<Input, number>> }
export interface Signature {rootCount:number;newestRootID:string|null;target?:{metadata:Metadata;observedAt:number}}
export interface DiscoveryPage { candidates: Candidate[]; cursor: string | null }
/** The provider owns parsing, scope and completeness. Ambiguity rejects the entire call. */
export interface Source {
  head(): Promise<Signature>;
  discover(cursor: string | null, inputs: readonly Input[]): Promise<DiscoveryPage>;
  observe(ids: readonly string[], inputs: readonly Input[]): Promise<(Candidate | null)[]>;
}
export type OrderResult=(
  | { status: 'ready'; ids: string[]; interval: { started: number; completed: number }; nextRefreshAt: number; revision: number }
  | { status: 'preparing'; retryAt: number }
  |{status:'paused';reason:'budget'|'upstream'|'size';retryAt:number|null})&{target?:{metadata:Metadata;count:CountObservation;observedAt:number}};
export interface Sql {
  exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>> & { readonly rowsRead: number; readonly rowsWritten: number };
}
export interface Storage { sql: Sql; transactionSync<T>(action: () => T): T }
export const DEFAULT_RANKING_LIMITS = Object.freeze({ refreshSeconds: 600, maxRequestsPerHour: 240, maxRowsWrittenPerDay: 36_000, maxRowsReadPerDay: 4_000_000, maxOrderBytes: 512 * 1024 });

export function requiredInputs(profiles: Record<string, Profile>): Input[] {
  return INPUTS.filter(input => Object.values(profiles).some(profile => (profile.weights[input] ?? 0) !== 0));
}
export function validCandidate(candidate: Candidate, required: readonly Input[]): boolean {
  return typeof candidate.id === 'string' && /^[A-Za-z0-9_+=:/.-]{1,200}$/.test(candidate.id) && Number.isSafeInteger(candidate.created) && candidate.created >= 0 && typeof candidate.eligible === 'boolean' && required.every(key => Number.isSafeInteger(candidate.values[key]) && candidate.values[key]! >= 0);
}
