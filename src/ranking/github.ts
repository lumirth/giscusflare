import { AppError } from '../domain/errors.js';
import { INPUTS, validCandidate, type Candidate, type DiscoveryPage, type Input, type Signature } from './types.js';

export interface RankingScope { repositoryId: string; discussionId: string; categoryId?: string; repo: string; category: string }
export interface Query { query: string; variables: Record<string, unknown> }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Incomplete ranking response.');
  return value as ObjectValue;
};
const scopeSelection = 'id repository{id nameWithOwner isPrivate} category{id name}';
function selection(inputs: readonly Input[]): string {
  return [
    inputs.some(input => INPUTS.slice(0, 8).includes(input)) ? 'reactionGroups{content reactors(first:1){totalCount}}' : '',
    inputs.includes('replies') ? 'replies(first:1){totalCount}' : '',
    inputs.includes('upvotes') ? 'upvoteCount' : '',
    inputs.includes('answer') ? 'isAnswer' : '',
  ].join(' ');
}
export function headQuery(scope: RankingScope): Query {
  return { query: `query RankHead($discussion:ID!){node(id:$discussion){... on Discussion{${scopeSelection} comments(last:1){totalCount nodes{id}}}}}`, variables: { discussion: scope.discussionId } };
}
export function discoveryQuery(scope: RankingScope, cursor: string | null, inputs: readonly Input[]): Query {
  return { query: `query RankDiscovery($discussion:ID!,$cursor:String){node(id:$discussion){... on Discussion{${scopeSelection} comments(last:100,before:$cursor){nodes{id createdAt isMinimized ${selection(inputs)}} pageInfo{hasPreviousPage startCursor}}}}}`, variables: { discussion: scope.discussionId, cursor } };
}
export function observationQuery(ids: readonly string[], inputs: readonly Input[]): Query {
  const variables: Record<string, unknown> = {}, declarations: string[] = [], fields: string[] = [];
  for (let offset = 0, part = 0; offset < ids.length; offset += 100, part++) {
    variables['ids' + part] = ids.slice(offset, offset + 100);
    declarations.push(`$ids${part}:[ID!]!`);
    fields.push(`batch${part}:nodes(ids:$ids${part}){... on DiscussionComment{id createdAt isMinimized replyTo{id} discussion{${scopeSelection}} ${selection(inputs)}}}`);
  }
  return { query: `query RankObservation(${declarations.join(',')}){${fields.join(' ')}}`, variables };
}
function data(payload: unknown): ObjectValue {
  const envelope = object(payload);
  if (Array.isArray(envelope.errors) && envelope.errors.length) throw Error('Incomplete ranking query.');
  return object(envelope.data);
}
function scoped(value: unknown, scope: RankingScope): ObjectValue {
  const discussion = object(value), repository = object(discussion.repository), category = object(discussion.category);
  if (discussion.id !== scope.discussionId || repository.id !== scope.repositoryId || repository.isPrivate !== false || String(repository.nameWithOwner).toLowerCase() !== scope.repo.toLowerCase() || (scope.categoryId && category.id !== scope.categoryId) || category.name !== scope.category) throw new AppError(403, 'PERMISSION', 'Ranking response is outside its public page.');
  return discussion;
}
function candidate(value: unknown, inputs: readonly Input[]): Candidate {
  const node = object(value), values: Candidate['values'] = {};
  for (const input of inputs) {
    if (input === 'replies') values.replies = object(node.replies).totalCount as number;
    else if (input === 'upvotes') values.upvotes = node.upvoteCount as number;
    else if (input === 'answer') { if (typeof node.isAnswer === 'boolean') values.answer = Number(node.isAnswer); }
    else {
      if (!Array.isArray(node.reactionGroups)) throw Error('Incomplete reaction counts.');
      const groups = node.reactionGroups.map(object).filter(item => item.content === input);
      if (groups.length !== 1) throw Error('Ambiguous reaction count.');
      values[input] = object(groups[0]!.reactors).totalCount as number;
    }
  }
  const result = { id: node.id as string, created: typeof node.createdAt === 'string' ? Date.parse(node.createdAt) : NaN, eligible: !node.isMinimized, values };
  if (typeof node.isMinimized !== 'boolean' || !validCandidate(result, inputs)) throw Error('Incomplete ranking inputs.');
  return result;
}
export function parseHead(payload: unknown, scope: RankingScope): Signature {
  const connection = object(scoped(data(payload).node, scope).comments);
  if (!Number.isSafeInteger(connection.totalCount) || Number(connection.totalCount) < 0 || !Array.isArray(connection.nodes) || connection.nodes.length > 1) throw Error('Incomplete ranking head.');
  const newestRootID = connection.nodes.length ? object(connection.nodes[0]).id : null;
  if ((connection.totalCount === 0) !== (newestRootID === null) || (newestRootID !== null && typeof newestRootID !== 'string')) throw Error('Incomplete ranking head.');
  return { rootCount: Number(connection.totalCount), newestRootID: newestRootID as string | null };
}
export function parseDiscovery(payload: unknown, scope: RankingScope, inputs: readonly Input[]): DiscoveryPage {
  const connection = object(scoped(data(payload).node, scope).comments), page = object(connection.pageInfo);
  if (!Array.isArray(connection.nodes) || connection.nodes.length > 100 || typeof page.hasPreviousPage !== 'boolean' || (page.hasPreviousPage && (!connection.nodes.length || typeof page.startCursor !== 'string'))) throw Error('Incomplete ranking page.');
  const candidates = connection.nodes.map(node => candidate(node, inputs));
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) throw Error('Duplicate ranking roots.');
  return { candidates, cursor: page.hasPreviousPage ? page.startCursor as string : null };
}
export function parseObservation(payload: unknown, ids: readonly string[], scope: RankingScope, inputs: readonly Input[]): (Candidate | null)[] {
  const result = data(payload);
  return ids.map((id, index) => {
    const nodes = result['batch' + Math.floor(index / 100)], offset = index % 100;
    if (!Array.isArray(nodes) || nodes.length !== Math.min(100, ids.length - Math.floor(index / 100) * 100)) throw Error('Incomplete ranking batch.');
    if (nodes[offset] === null) return null;
    const node = object(nodes[offset]);
    if (node.id !== id) throw Error('Ranking root does not match its requested ID.');
    if (!Object.hasOwn(node, 'replyTo') || (node.replyTo !== null && typeof object(node.replyTo).id !== 'string')) throw Error('Incomplete ranking root relationship.');
    const discussion = object(node.discussion);
    if (typeof discussion.id !== 'string') throw Error('Incomplete ranking discussion relationship.');
    if (node.replyTo !== null || discussion.id !== scope.discussionId) return null;
    scoped(discussion, scope);
    return candidate(node, inputs);
  });
}
