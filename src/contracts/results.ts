import * as v from 'valibot';
import { Comment, Discussion, ReactionSubject } from './github.js';
import { PositiveInteger } from './primitives.js';

/** Durable mutation result, shared by HTTP, retries and conversation consumers. */
export const MutationResult = v.strictObject({
  id: v.string(), number: PositiveInteger,
  comment: v.optional(Comment),
  reactions: v.optional(ReactionSubject),
  discussion: v.optional(v.nullable(Discussion)),
  blocked: v.optional(v.boolean()),
  removed: v.optional(v.boolean()),
});
export type MutationResult = v.InferOutput<typeof MutationResult>;

/** Read model shared by the service and every conversation client. */
export interface ThreadView {
  unavailable?:boolean;
  discussion:import('./github.js').Discussion|null;
  viewer:{login:string;avatarUrl:string;url:string}|null;
  archived:boolean;
  order:'oldest'|'newest';
  nextCursor:string|null;
}
