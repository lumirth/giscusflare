import * as v from 'valibot';
import { Capability, Cursor, DiscussionNumber, EmptyNodeID, IdempotencyKey, Language, Markdown, NodeID, Order, Origin, PageURL, Reaction, RepositoryName, SafeLine, Theme } from './primitives.js';
import { parse } from './parse.js';
import { AppError } from '../domain/errors.js';

const Term = v.pipe(v.string(), v.maxLength(256), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
const Description = v.pipe(v.string(), v.maxLength(2000), v.check(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)));
/** Discussion identity and authorization context, independent of presentation. */
export const Selection = v.pipe(v.strictObject({
  repo: RepositoryName, term: v.optional(Term, ''), number: v.optional(DiscussionNumber, 0),
  strict: v.optional(v.boolean(), false), origin: PageURL,
}), v.check(c => c.number > 0 || c.term.trim().length > 0));
export type Selection = v.InferOutput<typeof Selection>;
const Creation = v.strictObject({backLink:v.optional(v.union([v.literal(''),PageURL]),''),description:v.optional(Description,'')});
export const Widget = v.pipe(v.strictObject({
  ...Selection.pipe[0].entries,...Creation.entries,
  theme: v.optional(Theme, 'preferred_color_scheme'), lang: v.optional(Language, 'en'),
  reactionsEnabled: v.optional(v.boolean(), true), emitMetadata: v.optional(v.boolean(), false),
  inputPosition: v.optional(v.picklist(['top', 'bottom']), 'bottom'),
}), v.check(c => c.number > 0 || c.term.trim().length > 0),
  v.check(c => !c.backLink || new URL(c.backLink).origin === new URL(c.origin).origin));
export type Widget = v.InferOutput<typeof Widget>;
export {selection} from './selection.js';
// Query strings need conversion; JSON uses typed numbers and booleans.
const QueryBoolean = v.pipe(v.picklist(['0', '1', 'false', 'true']), v.transform(x => x === '1' || x === 'true'));
const QueryNumber = v.pipe(v.string(), v.regex(/^(?:0|[1-9]\d{0,9})$/), v.transform(Number), DiscussionNumber);
export const WidgetQuery = v.pipe(v.strictObject({
  ...Widget.pipe[0].entries,
  number: v.optional(QueryNumber, '0'), strict: v.optional(QueryBoolean, '0'),
  reactionsEnabled: v.optional(QueryBoolean, '1'), emitMetadata: v.optional(QueryBoolean, '0'),
}), v.transform(value => parse(Widget, value)));
export function queryObject(url: URL): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) throw new AppError(400, 'BAD_INPUT', 'Duplicate query parameters are not accepted.');
    result[key] = value;
  }
  return result;
}
/** One canonical window acquisition; the selector chooses roots, replies or IDs. */
export const PageRequest = v.pipe(v.strictObject({
  config: Selection, order: v.optional(Order, 'oldest'), cursor: v.optional(Cursor, ''),
  parentId: v.optional(NodeID), ids: v.optional(v.pipe(v.array(NodeID), v.maxLength(100))),
  replyPrefetch: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)), 5),
}), v.check(p => p.parentId === undefined || p.ids === undefined));
export const ModerationReason = v.picklist(['ABUSE', 'DUPLICATE', 'OFF_TOPIC', 'OUTDATED', 'RESOLVED', 'SPAM']);
export type ModerationReason = v.InferOutput<typeof ModerationReason>;
/** Commands describe user intent; all effects use the same contribution protocol. */
export const Action = v.variant('type', [
  v.strictObject({ type: v.literal('comment'), body: Markdown, replyToId: v.optional(EmptyNodeID, '') }),
  v.strictObject({ type: v.literal('edit'), id: NodeID, body: Markdown }),
  v.strictObject({ type: v.literal('delete'), id: NodeID }),
  v.strictObject({ type: v.literal('reaction'), id: v.union([NodeID, v.literal('discussion')]), reaction: Reaction, add: v.boolean() }),
  v.strictObject({ type: v.literal('moderate'), id: NodeID, minimized: v.boolean(), reason: v.optional(ModerationReason, 'OFF_TOPIC') }),
]);
export const ContributionRequest = v.pipe(v.strictObject({
  config: Selection, key: IdempotencyKey, action: Action, creation: v.optional(Creation, {}),
}), v.check(c => !c.creation.backLink || new URL(c.creation.backLink).origin === new URL(c.config.origin).origin));
export type PageRequest = v.InferOutput<typeof PageRequest>;
export type Action = v.InferOutput<typeof Action>;
export type ContributionRequest = v.InferOutput<typeof ContributionRequest>;
export const PreviewRequest = v.strictObject({ config: Selection, body: Markdown });
export const InfoRequest = v.strictObject({ repo: RepositoryName, origin: PageURL });
const AuthContext = { repo: RepositoryName, origin: PageURL, mode: v.picklist(['popup', 'redirect']), openerOrigin: v.optional(Origin) };
export const AuthWindow = v.strictObject({ ...AuthContext, attempt: Capability });
export const AuthPrepare = v.strictObject({ ...AuthContext, proof: Capability });
export const LogoutRequest = InfoRequest;
export const AuthStartQuery = v.strictObject({ repo: RepositoryName, attempt: Capability });
export const AuthCallbackQuery = v.strictObject({ iss:v.optional(v.literal('https://github.com/login/oauth')), state: v.pipe(SafeLine, v.maxLength(512)), code: v.optional(v.pipe(v.string(), v.maxLength(1024))), error: v.optional(v.pipe(v.string(), v.maxLength(256))), error_description: v.optional(SafeLine), error_uri: v.optional(PageURL) });
export type PreviewRequest = v.InferOutput<typeof PreviewRequest>;
export type InfoRequest = v.InferOutput<typeof InfoRequest>;
export type AuthPrepare = v.InferOutput<typeof AuthPrepare>;
export type AuthWindow = v.InferOutput<typeof AuthWindow>;


/** Public root-comment counts for lists; no session or conversation bodies. */
export const CountsRequest = v.strictObject({
  repo: RepositoryName, origin: PageURL, strict: v.optional(v.boolean(), true),
  terms: v.pipe(v.array(v.pipe(Term, v.check(s => Boolean(s.trim())))), v.minLength(1), v.maxLength(20)),
});
export type CountsRequest = v.InferOutput<typeof CountsRequest>;

export const RankingRequest=v.strictObject({config:Selection,profile:v.pipe(v.string(),v.regex(/^[a-z][a-z0-9_-]{0,31}$/))});
export type RankingRequest=v.InferOutput<typeof RankingRequest>;
