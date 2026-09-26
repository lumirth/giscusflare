import * as v from 'valibot';
import { Capability, CategoryName, Cursor, DiscussionNumber, EmptyCapability, EmptyNodeID, IdempotencyKey, Language, Markdown, NodeID, Order, PageURL, Reaction, RepositoryName, SafeLine, Theme } from './primitives.js';
import { parse } from './parse.js';
import { AppError } from '../domain/errors.js';

const Term = v.pipe(v.string(), v.maxLength(256), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
const Description = v.pipe(v.string(), v.maxLength(2000), v.check(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)));
export const Widget = v.pipe(v.strictObject({
  repo: RepositoryName, repoId: v.optional(EmptyNodeID, ''), category: v.optional(v.union([v.literal(''), CategoryName]), ''),
  categoryId: v.optional(EmptyNodeID, ''), term: v.optional(Term, ''), number: v.optional(DiscussionNumber, 0),
  strict: v.optional(v.boolean(), false), origin: PageURL, backLink: v.optional(v.union([v.literal(''), PageURL]), ''),
  description: v.optional(Description, ''), theme: v.optional(Theme, 'preferred_color_scheme'),
  lang: v.optional(Language, 'en'), reactionsEnabled: v.optional(v.boolean(), true), emitMetadata: v.optional(v.boolean(), false),
  inputPosition: v.optional(v.picklist(['top', 'bottom']), 'bottom'),
}), v.check(c => c.number > 0 || c.term.trim().length > 0),
  v.check(c => !c.backLink || new URL(c.backLink).origin === new URL(c.origin).origin));
export type Widget = v.InferOutput<typeof Widget>;
// Query strings need conversion; JSON uses typed numbers and booleans.
const QueryBoolean = v.pipe(v.picklist(['0', '1', 'false', 'true']), v.transform(x => x === '1' || x === 'true'));
const QueryNumber = v.pipe(v.string(), v.regex(/^(?:0|[1-9]\d{0,9})$/), v.transform(Number), DiscussionNumber);
export const WidgetQuery = v.pipe(v.strictObject({
  repo: RepositoryName, repoId: v.optional(EmptyNodeID, ''), category: v.optional(v.union([v.literal(''), CategoryName]), ''), categoryId: v.optional(EmptyNodeID, ''),
  term: v.optional(Term, ''), number: v.optional(QueryNumber, '0'), strict: v.optional(QueryBoolean, '0'), origin: PageURL,
  backLink: v.optional(v.union([v.literal(''), PageURL]), ''), description: v.optional(Description, ''),
  theme: v.optional(Theme, 'preferred_color_scheme'), lang: v.optional(Language, 'en'),
  reactionsEnabled: v.optional(QueryBoolean, '1'), emitMetadata: v.optional(QueryBoolean, '0'),
  inputPosition: v.optional(v.picklist(['top', 'bottom']), 'bottom'),
}), v.transform(value => parse(Widget, value)));
export function queryObject(url: URL): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) throw new AppError(400, 'BAD_INPUT', 'Duplicate query parameters are not accepted.');
    result[key] = value;
  }
  return result;
}
export const ThreadRequest = v.strictObject({ config: Widget, order: v.optional(Order, 'oldest'), cursor: v.optional(Cursor, '') });
export const RepliesRequest = v.strictObject({ config: Widget, parentId: NodeID, cursor: v.optional(Cursor, '') });
export const CommentRequest = v.strictObject({ config: Widget, body: Markdown, replyToId: v.optional(EmptyNodeID, ''), key: IdempotencyKey });
export const EditRequest = v.strictObject({ config: Widget, id: NodeID, body: Markdown, key: IdempotencyKey });
export const DeleteRequest = v.strictObject({ config: Widget, id: NodeID, key: IdempotencyKey });
export const ReactionRequest = v.strictObject({ config: Widget, id: v.union([NodeID, v.literal('discussion')]), reaction: Reaction, add: v.boolean(), key: IdempotencyKey });
export const ModerateRequest = v.strictObject({ config: Widget, id: NodeID, minimized: v.boolean(), key: IdempotencyKey });
export const PreviewRequest = v.strictObject({ config: Widget, body: Markdown });
export const InfoRequest = v.strictObject({ repo: RepositoryName, origin: PageURL });
export const AuthPrepare = v.strictObject({ repo: RepositoryName, origin: PageURL, challenge: Capability, mode: v.picklist(['popup', 'redirect']) });
export const AuthProof = v.strictObject({ repo: RepositoryName, origin: PageURL, attempt: Capability, verifier: Capability });
export const AuthConsume = v.strictObject({ ...AuthProof.entries, ticket: Capability });
export const LogoutRequest = InfoRequest;
export const AuthStartQuery = v.strictObject({ repo: RepositoryName, attempt: Capability });
export const AuthCallbackQuery = v.strictObject({ state: v.pipe(SafeLine, v.maxLength(512)), code: v.optional(v.pipe(v.string(), v.maxLength(1024))), error: v.optional(v.pipe(v.string(), v.maxLength(256))), error_description: v.optional(SafeLine), error_uri: v.optional(PageURL) });
export const Caller = v.strictObject({ repo: RepositoryName, origin: PageURL, session: v.optional(EmptyCapability, '') });
export type Caller = v.InferOutput<typeof Caller>;
export type ThreadRequest = v.InferOutput<typeof ThreadRequest>;
export type RepliesRequest = v.InferOutput<typeof RepliesRequest>;
export type CommentRequest = v.InferOutput<typeof CommentRequest>;
export type EditRequest = v.InferOutput<typeof EditRequest>;
export type DeleteRequest = v.InferOutput<typeof DeleteRequest>;
export type ReactionRequest = v.InferOutput<typeof ReactionRequest>;
export type ModerateRequest = v.InferOutput<typeof ModerateRequest>;
export type PreviewRequest = v.InferOutput<typeof PreviewRequest>;
export type InfoRequest = v.InferOutput<typeof InfoRequest>;
export type AuthPrepare = v.InferOutput<typeof AuthPrepare>;
export type AuthProof = v.InferOutput<typeof AuthProof>;

export type AuthConsume = v.InferOutput<typeof AuthConsume>;
