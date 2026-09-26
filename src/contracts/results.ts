import * as v from 'valibot';
import { Comment, ReactionSubject } from './github.js';
import { PositiveInteger } from './primitives.js';

/** Durable mutation result, shared by HTTP, retries and conversation consumers. */
export const MutationResult = v.strictObject({
  id: v.string(), number: PositiveInteger,
  comment: v.optional(Comment),
  reactions: v.optional(ReactionSubject),
  removed: v.optional(v.boolean()),
});
export type MutationResult = v.InferOutput<typeof MutationResult>;
