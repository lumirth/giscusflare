import * as v from 'valibot';
import { Count, HttpsURL, ISODate, NodeID, PositiveInteger, Reaction, Token, User } from './primitives.js';
const Body = v.pipe(v.string(), v.maxLength(1000000));
export const PageInfo = v.object({ hasNextPage: v.boolean(), hasPreviousPage: v.boolean(), startCursor: v.nullable(v.string()), endCursor: v.nullable(v.string()) });
export const ReactionGroup = v.object({ content: Reaction, viewerHasReacted: v.boolean(), users: v.object({ totalCount: Count }) });
export const Reactions = v.pipe(v.array(ReactionGroup), v.maxLength(8));
export const Comment = v.object({
  id: NodeID, body: Body, bodyHTML: Body, url: HttpsURL, createdAt: ISODate, lastEditedAt: v.nullable(ISODate),
  author: v.nullable(User), authorAssociation: v.string(), viewerDidAuthor: v.boolean(),
  viewerCanUpdate: v.boolean(), viewerCanDelete: v.boolean(), viewerCanMinimize: v.boolean(),
  viewerCanUnminimize: v.optional(v.boolean(), false), deletedAt: v.optional(v.nullable(ISODate), null),
  isAnswer: v.optional(v.boolean(), false), viewerCanMarkAsAnswer: v.optional(v.boolean(), false), viewerCanUnmarkAsAnswer: v.optional(v.boolean(), false),
  isMinimized: v.boolean(), minimizedReason: v.nullable(v.string()), reactionGroups: Reactions,
  replyTo: v.optional(v.nullable(v.object({ id: NodeID })), null),
});
export const Replies = v.object({ totalCount: Count, pageInfo: PageInfo, nodes: v.pipe(v.array(Comment), v.maxLength(100)) });
export const RootComment = v.object({ ...Comment.entries, replies: Replies });
export const Comments = v.object({ totalCount: Count, pageInfo: PageInfo, nodes: v.pipe(v.array(RootComment), v.maxLength(20)) });
export const Scope = v.object({ repository: v.object({ id: NodeID, nameWithOwner: v.string(), isPrivate: v.boolean() }), category: v.object({ id: NodeID, name: v.string() }) });
export const DiscussionSummary = v.object({
  ...Scope.entries, id: NodeID, number: PositiveInteger, title: v.string(), body: Body, bodyHTML: Body,
  url: HttpsURL, locked: v.boolean(), closed: v.optional(v.boolean(), false), viewerCanClose: v.optional(v.boolean(), false), viewerCanReopen: v.optional(v.boolean(), false), viewerCanDelete: v.optional(v.boolean(), false), viewerCanUpdate: v.optional(v.boolean(), false), viewerCanLock: v.optional(v.boolean(), false), answer: v.optional(v.nullable(v.object({id:NodeID})), null), reactionGroups: Reactions,
});
export const Discussion = v.object({ ...DiscussionSummary.entries, comments: Comments });
export const Repository = v.object({
  id: NodeID, nameWithOwner: v.string(), isPrivate: v.boolean(), isArchived: v.boolean(),
  discussionCategories: v.object({ nodes: v.pipe(v.array(v.object({ id: NodeID, name: v.string(), isAnswerable: v.boolean() })), v.maxLength(100)) }),
});
export const RepositoryResponse = v.object({ repository: v.nullable(Repository) });
export const ThreadResponse = v.object({ repository: v.nullable(v.object({ isPrivate: v.boolean(), viewerPermission: v.optional(v.nullable(v.string()),null), discussion: v.nullable(Discussion) })) });
export const SearchResponse = v.object({ search: v.object({ discussionCount: Count, nodes: v.pipe(v.array(v.nullable(DiscussionSummary)), v.maxLength(10)) }) });
export const Target = v.variant('__typename', [
  v.object({ __typename: v.literal('Discussion'), ...DiscussionSummary.entries }),
  v.object({ __typename: v.literal('DiscussionComment'), ...Comment.entries, discussion: DiscussionSummary }),
]);
export const TargetResponse = v.object({ node: v.nullable(Target) });
export const RepliesResponse = v.object({ node: v.nullable(v.object({ id: NodeID, discussion: DiscussionSummary, replies: Replies })) });
export const Installation = v.object({ id: PositiveInteger });
export const InstallationToken = v.object({ token: Token, expires_at: ISODate });
export const OAuthToken = v.pipe(v.object({
  access_token: Token, token_type: v.optional(v.string()), expires_in: v.optional(PositiveInteger),
  refresh_token: v.optional(Token), refresh_token_expires_in: v.optional(PositiveInteger),
}), v.check(x => !x.refresh_token || Boolean(x.refresh_token_expires_in)));
export const Viewer = v.object({ login: User.entries.login, avatar_url: HttpsURL, html_url: HttpsURL });
export const GraphQLError = v.object({ type: v.optional(v.string()), message: v.optional(v.string()) });
export const GraphQLEnvelope = v.object({ data: v.optional(v.unknown()), errors: v.optional(v.array(GraphQLError)) });
export const CreateResponse = v.object({ createDiscussion: v.object({ discussion: v.object({ id: NodeID, number: PositiveInteger }) }) });
export const AddCommentResponse = v.object({ addDiscussionComment: v.object({ comment: Comment }) });
export const EditResponse = v.object({ updateDiscussionComment: v.object({ comment: Comment }) });
export const DeleteResponse = v.object({ deleteDiscussionComment: v.object({ comment: v.nullable(Comment) }) });
export const ReactionSubject = v.object({ id: NodeID, reactionGroups: Reactions });
export const AddReactionResponse = v.object({ addReaction: v.object({ subject: ReactionSubject }) });
export const RemoveReactionResponse = v.object({ removeReaction: v.object({ subject: ReactionSubject }) });
export const MinimizeResponse = v.object({ minimizeComment: v.object({ clientMutationId: v.nullable(v.string()) }) });
export const UnminimizeResponse = v.object({ unminimizeComment: v.object({ clientMutationId: v.nullable(v.string()) }) });
export type Comment = v.InferOutput<typeof Comment>;
export type RootComment = v.InferOutput<typeof RootComment>;
export type Discussion = v.InferOutput<typeof Discussion>;
export type DiscussionSummary = v.InferOutput<typeof DiscussionSummary>;
export type Repository = v.InferOutput<typeof Repository>;
export type OAuthToken = v.InferOutput<typeof OAuthToken>;
export type Target = v.InferOutput<typeof Target>;
export type Replies = v.InferOutput<typeof Replies>;
