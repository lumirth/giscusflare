import * as v from 'valibot';
import { Capability, Cursor, DiscussionNumber, EmptyNodeID, IdempotencyKey, Language, Markdown, NodeID, Order, Origin, PageURL, Reaction, RepositoryName, SafeLine, Theme } from './primitives.js';
import { parse } from './parse.js';
import { AppError } from '../domain/errors.js';

const Term = v.pipe(v.string(), v.maxLength(256), v.check(s => !/[\u0000-\u001f\u007f]/u.test(s)));
const Description = v.pipe(v.string(), v.maxLength(2000), v.check(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)));
/** Canonical selection, website authority and rendering/return URLs are distinct. */
export const Selector = v.variant('kind', [
  v.strictObject({kind:v.literal('page'),key:v.pipe(Term,v.check(s=>Boolean(s.trim())))}),
  v.strictObject({kind:v.literal('discussion'),number:v.pipe(DiscussionNumber,v.minValue(1)),id:v.optional(NodeID)}),
]);
export type Selector=v.InferOutput<typeof Selector>;
export const CountTarget=v.strictObject({selector:Selector,window:v.variant('kind',[v.strictObject({kind:v.literal('roots')}),v.strictObject({kind:v.literal('replies'),parentId:NodeID})])});
const sameReturnOrigin=(value:{origin:string;returnURL:string})=>new URL(value.returnURL).origin===value.origin;
export const Selection = v.pipe(v.strictObject({
  repo:RepositoryName,selector:Selector,origin:Origin,pageURL:PageURL,returnURL:PageURL,
  registration:v.optional(v.pipe(v.string(),v.maxLength(8192))),
}),v.check(value=>sameReturnOrigin(value)));
export type Selection=v.InferOutput<typeof Selection>;
const Creation=v.strictObject({description:v.optional(Description,'')});
export const Widget=v.pipe(v.strictObject({
  ...Selection.pipe[0].entries,...Creation.entries,
  theme:v.optional(Theme,'preferred_color_scheme'),lang:v.optional(Language,'en'),
  reactionsEnabled:v.optional(v.boolean(),true),emitMetadata:v.optional(v.boolean(),false),
  inputPosition:v.optional(v.picklist(['top','bottom']),'bottom'),
}),v.check(value=>sameReturnOrigin(value)));
export type Widget = v.InferOutput<typeof Widget>;
export {selection} from './selection.js';
// Query strings need conversion; JSON uses typed numbers and booleans.
const QueryBoolean = v.pipe(v.picklist(['0', '1', 'false', 'true']), v.transform(x => x === '1' || x === 'true'));
const QueryNumber = v.pipe(v.string(), v.regex(/^(?:0|[1-9]\d{0,9})$/), v.transform(Number), DiscussionNumber);
export const WidgetQuery=v.pipe(v.strictObject({
  repo:RepositoryName,key:v.optional(Term),number:v.optional(QueryNumber),discussionId:v.optional(NodeID),
  origin:Origin,pageURL:PageURL,returnURL:PageURL,registration:v.optional(v.pipe(v.string(),v.maxLength(8192))),
  description:v.optional(Description,''),theme:v.optional(Theme,'preferred_color_scheme'),lang:v.optional(Language,'en'),
  reactionsEnabled:v.optional(QueryBoolean,'1'),emitMetadata:v.optional(QueryBoolean,'0'),
  inputPosition:v.optional(v.picklist(['top','bottom']),'bottom'),
}),v.check(c=>Boolean(c.key)!==Boolean(c.number)),v.transform(({key,number,discussionId,...value})=>parse(Widget,{...value,
  selector:key?{kind:'page',key}:{kind:'discussion',number,...(discussionId?{id:discussionId}:{})}})));
export function queryObject(url: URL): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) throw new AppError(400, 'BAD_INPUT', 'Duplicate query parameters are not accepted.');
    result[key] = value;
  }
  return result;
}
/** A read describes exactly one capability; contradictory flag combinations are unrepresentable. */
const ReplyPrefetch=v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(100)),5);
const IDs=v.pipe(v.array(NodeID),v.maxLength(100));
export const ReadIntent=v.variant('kind',[
  v.strictObject({kind:v.literal('roots'),order:v.optional(Order,'oldest'),cursor:v.optional(Cursor,''),replyPrefetch:ReplyPrefetch}),
  v.strictObject({kind:v.literal('replies'),parentId:NodeID,cursor:v.optional(Cursor,'')}),
  v.strictObject({kind:v.literal('observe'),ids:IDs}),
  v.strictObject({kind:v.literal('selected'),ids:IDs,replyPrefetch:ReplyPrefetch}),
]);
export type ReadIntent=v.InferOutput<typeof ReadIntent>;
export const PageRequest=v.strictObject({config:Selection,read:ReadIntent,fresh:v.optional(v.boolean(),false),providerHTML:v.optional(v.boolean(),false)});
export const ModerationReason = v.picklist(['ABUSE', 'DUPLICATE', 'OFF_TOPIC', 'OUTDATED', 'RESOLVED', 'SPAM']);
export type ModerationReason = v.InferOutput<typeof ModerationReason>;
/** Commands describe user intent; all effects use the same contribution protocol. */
export const Action = v.variant('type', [
  v.strictObject({ type: v.literal('comment'), body: Markdown, replyToId: v.optional(EmptyNodeID, '') }),
  v.strictObject({ type: v.literal('edit'), id: NodeID, body: Markdown }),
  v.strictObject({ type: v.literal('delete'), id: NodeID }),
  v.strictObject({ type: v.literal('reaction'), subject: v.variant('kind', [
    v.strictObject({ kind: v.literal('discussion') }),
    v.strictObject({ kind: v.literal('comment'), id: NodeID }),
  ]), reaction: Reaction, selected: v.boolean() }),
  v.strictObject({ type: v.literal('moderate'), id: NodeID, minimized: v.boolean(), reason: v.optional(ModerationReason, 'OFF_TOPIC') }),
]);
export const ContributionRequest = v.pipe(v.strictObject({
  config: Selection, key: IdempotencyKey, action: Action, providerHTML:v.optional(v.boolean(),false), creation: v.optional(Creation, {}),
}));
export type PageRequest = v.InferOutput<typeof PageRequest>;
export type Action = v.InferOutput<typeof Action>;
export type ContributionRequest = v.InferOutput<typeof ContributionRequest>;
export const InfoRequest = v.strictObject({ repo: RepositoryName, origin: Origin, registration:v.optional(v.pipe(v.string(),v.maxLength(8192))) });
export const AccessRequest=v.strictObject({config:Selection,ids:v.optional(v.pipe(v.array(NodeID),v.maxLength(100)),[])});
const AuthContext = { ...InfoRequest.entries, returnURL:PageURL, mode: v.picklist(['popup', 'redirect']), openerOrigin: v.optional(Origin) };
export const AuthWindow = v.strictObject({ ...AuthContext, attempt: Capability });
export const AuthPrepare = v.strictObject({ ...AuthContext, proof: Capability });
export const LogoutRequest = InfoRequest;
export const AuthStartQuery = v.strictObject({ repo:RepositoryName,registration:v.optional(v.pipe(v.string(),v.maxLength(8192))),attempt:Capability});
export const AuthCallbackQuery = v.strictObject({ iss:v.optional(v.literal('https://github.com/login/oauth')), state:v.pipe(SafeLine,v.maxLength(8192)), code: v.optional(v.pipe(v.string(), v.maxLength(1024))), error: v.optional(v.pipe(v.string(), v.maxLength(256))), error_description: v.optional(SafeLine), error_uri: v.optional(PageURL) });
export type AuthStartQuery=v.InferOutput<typeof AuthStartQuery>;
export type InfoRequest = v.InferOutput<typeof InfoRequest>;
export type AuthPrepare = v.InferOutput<typeof AuthPrepare>;
export type AuthWindow = v.InferOutput<typeof AuthWindow>;


/** Public root-comment counts for lists; no session or conversation bodies. */
export const CountsRequest = v.strictObject({
  ...InfoRequest.entries,fresh:v.optional(v.boolean(),false),
  targets:v.pipe(v.array(CountTarget),v.minLength(1),v.maxLength(20)),
});
export type CountsRequest = v.InferOutput<typeof CountsRequest>;

export const RankingRequest=v.strictObject({config:Selection,profile:v.pipe(v.string(),v.regex(/^[a-z][a-z0-9_-]{0,31}$/))});
export type RankingRequest=v.InferOutput<typeof RankingRequest>;
