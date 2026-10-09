import * as v from 'valibot';
import { Count, HttpsURL, ISODate, NodeID, PositiveInteger, Reaction, Token, User } from './primitives.js';
const Body = v.pipe(v.string(), v.maxLength(1000000));
export const PageInfo = v.object({ hasNextPage: v.boolean(), hasPreviousPage: v.boolean(), startCursor: v.nullable(v.string()), endCursor: v.nullable(v.string()) });
export const ReactionGroup = v.object({ content: Reaction, viewerHasReacted: v.boolean(), reactors: v.object({ totalCount: Count }) });
export const Reactions = v.pipe(v.array(ReactionGroup), v.maxLength(8));
export const Comment = v.object({
    id: NodeID, body: Body, bodyHTML: v.optional(Body), url: HttpsURL, createdAt: ISODate, lastEditedAt: v.nullable(ISODate),
    author: v.nullable(User), authorAssociation: v.string(), viewerDidAuthor: v.boolean(),
    viewerCanUpdate: v.boolean(), viewerCanDelete: v.boolean(), viewerCanMinimize: v.boolean(),
    viewerCanUnminimize: v.boolean(), deletedAt: v.nullable(ISODate),
    upvoteCount: Count,
    isMinimized: v.boolean(), minimizedReason: v.nullable(v.string()), reactionGroups: Reactions,
    replyTo: v.nullable(v.object({ id: NodeID })),
});
export const Replies = v.object({ totalCount: Count, pageInfo: PageInfo, nodes: v.pipe(v.array(Comment), v.maxLength(100)) });
export const RootComment = v.object({ ...Comment.entries, replies: Replies, discussion: v.lazy(() => DiscussionIdentity) });
export const Scope = v.object({ repository: v.object({ id: NodeID, nameWithOwner: v.string(), isPrivate: v.boolean() }), category:v.object({id:NodeID}) });
export const DiscussionIdentity = v.object({ ...Scope.entries, id: NodeID, number: PositiveInteger });
export const DiscussionAccess = v.object({ ...DiscussionIdentity.entries, locked: v.boolean() });
export const DiscussionSummary = v.object({
    ...Scope.entries, id: NodeID, number: PositiveInteger, title: v.string(),
    url: HttpsURL, locked: v.boolean(), closed: v.boolean(), answer: v.nullable(v.object({ id: NodeID })), reactionGroups: Reactions,
});
export const RepositoryHead = v.object({ id: NodeID, nameWithOwner: v.string(), isPrivate: v.boolean(), isArchived: v.boolean() });
export const Repository = v.object({
    ...RepositoryHead.entries,
    discussionCategories: v.object({ nodes: v.pipe(v.array(v.object({ id: NodeID, name: v.string() })), v.maxLength(100)) }),
});
export const RepositoryResponse = v.object({ repository: v.nullable(Repository) });
export const Installation = v.object({ id: PositiveInteger });
export const InstallationToken = v.object({ token: Token, expires_at: ISODate });
export const OAuthToken = v.pipe(v.object({
    access_token: Token, token_type: v.optional(v.string()), expires_in: v.optional(PositiveInteger),
    refresh_token: v.optional(Token), refresh_token_expires_in: v.optional(PositiveInteger),
}), v.check(x => !x.refresh_token || Boolean(x.refresh_token_expires_in)));
export const Viewer=v.object({node_id:NodeID,login:User.entries.login,avatar_url:User.entries.avatarUrl,html_url:User.entries.url});
export const GraphQLError = v.object({ type: v.optional(v.string()), message: v.optional(v.string()), path: v.optional(v.array(v.union([v.string(), v.number()]))) });
export const GraphQLEnvelope = v.object({ data: v.optional(v.unknown()), errors: v.optional(v.array(GraphQLError)) });
export type Comment = v.InferOutput<typeof Comment>;
export type RootComment = v.InferOutput<typeof RootComment>;
export type DiscussionSummary = v.InferOutput<typeof DiscussionSummary>;
export type Repository = v.InferOutput<typeof Repository>;
export type RepositoryHead = v.InferOutput<typeof RepositoryHead>;
export type OAuthToken = v.InferOutput<typeof OAuthToken>;
export type Replies = v.InferOutput<typeof Replies>;
export const DiscussionCount = v.object({
    ...Scope.entries, id:NodeID,number: PositiveInteger, body: v.optional(Body, ''), comments: v.object({ totalCount: Count }),
});
export type DiscussionCount = v.InferOutput<typeof DiscussionCount>;
export type DiscussionIdentity = v.InferOutput<typeof DiscussionIdentity>;
export type DiscussionAccess = v.InferOutput<typeof DiscussionAccess>;
