import type * as GitHub from '../contracts/github.js';
import type { MutationResult as WireMutation } from '../contracts/results.js';
import type { ReactionRequest } from '../contracts/requests.js';
export type Reaction = ReactionRequest['reaction'];
export interface ReactionValue { count: number; selected: boolean }
export type Reactions = Readonly<Partial<Record<Reaction, ReactionValue>>>;
export interface Person { login: string; avatarUrl: string; url: string }
export interface Comment {
  id: string; body: string; bodyHTML: string; url: string; createdAt: string;
  lastEditedAt: string | null; author: Person | null; authorAssociation: string;
  viewerDidAuthor: boolean; viewerCanUpdate: boolean; viewerCanDelete: boolean;
  viewerCanMinimize: boolean; viewerCanUnminimize: boolean;
  deletedAt: string | null; isAnswer: boolean; isMinimized: boolean;
  minimizedReason: string | null; reactions: Reactions; replyToId: string | null;
}
export interface Replies { count: number; items: Comment[]; cursor: string | null }
export interface RootComment extends Comment { replies: Replies }
export interface Discussion {
  id: string; number: number; title: string; url: string; locked: boolean;
  closed: boolean; answerId: string | null; commentCount: number; reactions: Reactions;
}
export interface ActionResult {
  id: string; number: number; comment?: Comment;
  reactions?: { id: string; reactions: Reactions };
  removed?: boolean;
}
export function reactions(groups: GitHub.Comment['reactionGroups']): Reactions {
  return Object.fromEntries(groups.map(group => [group.content, { count: group.users.totalCount, selected: group.viewerHasReacted }]));
}
export function comment(value: GitHub.Comment): Comment {
  return {
    id:value.id, body:value.body, bodyHTML:value.bodyHTML, url:value.url, createdAt:value.createdAt,
    lastEditedAt:value.lastEditedAt, author:value.author, authorAssociation:value.authorAssociation,
    viewerDidAuthor:value.viewerDidAuthor, viewerCanUpdate:value.viewerCanUpdate, viewerCanDelete:value.viewerCanDelete,
    viewerCanMinimize:value.viewerCanMinimize, viewerCanUnminimize:value.viewerCanUnminimize,
    deletedAt:value.deletedAt, isAnswer:value.isAnswer, isMinimized:value.isMinimized,
    minimizedReason:value.minimizedReason, reactions:reactions(value.reactionGroups), replyToId:value.replyTo?.id ?? null,
  };
}
export function replies(value: GitHub.Replies): Replies {
  return {count:value.totalCount,items:value.nodes.map(comment),cursor:value.pageInfo.hasPreviousPage?value.pageInfo.startCursor:null};
}
export function rootComment(value: GitHub.RootComment): RootComment { return {...comment(value),replies:replies(value.replies)}; }
export function discussion(value: GitHub.Discussion): Discussion {
  return {id:value.id,number:value.number,title:value.title,url:value.url,locked:value.locked,closed:value.closed,
    answerId:value.answer?.id??null,commentCount:value.comments.totalCount,reactions:reactions(value.reactionGroups)};
}
export function actionResult(value: WireMutation): ActionResult {
  return {id:value.id,number:value.number,...(value.comment?{comment:comment(value.comment)}:{}),
    ...(value.reactions?{reactions:{id:value.reactions.id,reactions:reactions(value.reactions.reactionGroups)}}:{}),
    ...(value.removed?{removed:true}:{})};
}
