import { validCandidate, type Candidate, type Input, type Profile } from './types.js';

/** Complete inputs only. Counters may decrease; no monotonic-score assumption. */
export function order(candidates: Iterable<Candidate>, profile: Profile, maxBytes: number): string[] {
  const weights = Object.entries(profile.weights).filter(([, weight]) => weight !== 0) as [Input, number][];
  const required = weights.map(([input]) => input);
  const scored: { id: string; created: number; score: number }[] = [];
  for (const candidate of candidates) {
    if (!validCandidate(candidate, required)) throw new Error('RANKING_INPUTS');
    if (!candidate.eligible) continue;
    const score = weights.reduce((sum, [input, weight]) => sum + candidate.values[input]! * weight, 0);
    if (!Number.isFinite(score)) throw new Error('RANKING_INPUTS');
    scored.push({ id: candidate.id, created: candidate.created, score });
  }
  const sign = profile.tieBreak === 'oldest' ? 1 : -1;
  scored.sort((a, b) => b.score - a.score || sign * (a.created - b.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = scored.map(candidate => candidate.id);
  if (new TextEncoder().encode(JSON.stringify(ids)).byteLength > maxBytes) throw new Error('RANKING_SIZE');
  return ids;
}

/** The cursor advances over requested positions, including deleted comments. */
export function traversalPage(ids: readonly string[], offset: number, limit = 20): { ids: string[]; next: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > ids.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid ranking page.');
  return { ids: ids.slice(offset, offset + limit), next: Math.min(ids.length, offset + limit) };
}
