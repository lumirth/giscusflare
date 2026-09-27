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
export interface MutationResult {
  id: string;
  number: number;
  comment?: Comment;
  reactions?: ReactionSubject;
  discussion?: Discussion | null;
  blocked?: boolean;
  removed?: boolean;
}

/** Read model shared by the service and every conversation client. */
export interface ThreadView {
  profiles?:string[];
  unavailable?:boolean;
  discussion:import('./github.js').Discussion|null;
  viewer:{login:string;avatarUrl:string;url:string}|null;
  archived:boolean;
  order:'oldest'|'newest';
  nextCursor:string|null;
}
