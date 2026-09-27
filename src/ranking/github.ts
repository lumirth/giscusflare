import { INPUTS, validCandidate, type Candidate, type DiscoveryPage, type Input, type ObservationBatch } from './types.js';
export interface RankingScope { repositoryId: string; discussionId: string; categoryId?: string }
export interface Query { query: string; variables: Record<string, unknown> }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
function inputsSelection(inputs: readonly Input[]): string {
  const reactions = inputs.some(input => INPUTS.slice(0, 8).includes(input));
  return [reactions ? 'reactionGroups { content reactors { totalCount } }' : '', inputs.includes('replies') ? 'replies { totalCount }' : '', inputs.includes('upvotes') ? 'upvoteCount' : '', inputs.includes('answer') ? 'isAnswer' : ''].filter(Boolean).join(' ');
}
const scopeSelection = 'id repository { id isPrivate } category { id }';
/** Metadata only: no comment bodies, author profiles or reply content. */
export function discoveryQuery(scope: RankingScope, cursor: string | null, inputs: readonly Input[]): Query {
  return { query: `query($discussion:ID!,$cursor:String){node(id:$discussion){... on Discussion{${scopeSelection} comments(last:100,before:$cursor){nodes{id createdAt isMinimized ${inputsSelection(inputs)}} pageInfo{hasPreviousPage startCursor}}}}}`, variables: { discussion: scope.discussionId, cursor } };
}
/** Grouped reactions are cheaper than separate filtered count connections. */
export function observationQuery(ids: readonly string[], inputs: readonly Input[]): Query {
  if (!ids.length || ids.length > (inputs.includes('replies') ? 500 : 800) || new Set(ids).size !== ids.length) throw new Error('Invalid ranking batch.');
  const variables: Record<string, unknown> = {}, declarations: string[] = [], fields: string[] = [];
  for (let offset = 0, part = 0; offset < ids.length; offset += 100, part++) {
    variables['ids' + part] = ids.slice(offset, offset + 100); declarations.push(`$ids${part}:[ID!]!`);
    fields.push(`batch${part}:nodes(ids:$ids${part}){... on DiscussionComment{id createdAt isMinimized replyTo{id} discussion{${scopeSelection}} ${inputsSelection(inputs)}}}`);
  }
  return { query: `query(${declarations.join(',')}){${fields.join(' ')}}`, variables };
}
function sameScope(value: unknown, scope: RankingScope): boolean {
  const discussion = object(value), repository = object(discussion?.repository), category = object(discussion?.category);
  return discussion?.id === scope.discussionId && repository?.id === scope.repositoryId && repository.isPrivate === false && (!scope.categoryId || category?.id === scope.categoryId);
}
function candidate(value: unknown, inputs: readonly Input[]): Candidate | undefined {
  const node = object(value);
  if (!node || typeof node.id !== 'string' || typeof node.createdAt !== 'string' || typeof node.isMinimized !== 'boolean') return;
  const values: Candidate['values'] = {};
  for (const input of inputs) {
    if (input === 'replies') values.replies = object(node.replies)?.totalCount as number;
    else if (input === 'upvotes') values.upvotes = node.upvoteCount as number;
    else if (input === 'answer') { if (typeof node.isAnswer === 'boolean') values.answer = node.isAnswer ? 1 : 0; }
    else {
      if (!Array.isArray(node.reactionGroups)) return;
      const group = node.reactionGroups.map(object).find(group => group?.content === input);
      values[input] = object(group?.reactors)?.totalCount as number;
    }
  }
  const result: Candidate = { id: node.id, created: Date.parse(node.createdAt), eligible: !node.isMinimized, values };
  return validCandidate(result, inputs) ? result : undefined;
}
export function parseDiscovery(payload: unknown, scope: RankingScope, inputs: readonly Input[]): DiscoveryPage {
  const root = object(payload), node = object(object(root?.data)?.node), connection = object(node?.comments), page = object(connection?.pageInfo);
  if (!sameScope(node, scope)) throw new Error('Ranking discussion is outside its public repository scope.');
  if (Array.isArray(root?.errors) && root.errors.length) return { candidates: [], cursor: null, complete: false };
  if (!Array.isArray(connection?.nodes) || typeof page?.hasPreviousPage !== 'boolean' || (page.hasPreviousPage && typeof page.startCursor !== 'string')) return { candidates: [], cursor: null, complete: false };
  const candidates = connection.nodes.map(value => candidate(value, inputs));
  if (candidates.some(item => !item)) return { candidates: [], cursor: null, complete: false };
  return { candidates: (candidates as Candidate[]).reverse(), cursor: page.hasPreviousPage ? page.startCursor as string : null, complete: true };
}
export function parseObservation(payload: unknown, ids: readonly string[], scope: RankingScope, inputs: readonly Input[]): ObservationBatch {
  const root = object(payload), data = object(root?.data), errors = Array.isArray(root?.errors) ? root.errors.map(object) : [];
  const candidates: Candidate[] = [], deleted: string[] = [], unresolved: string[] = [];
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!, alias = 'batch' + Math.floor(index / 100), offset = index % 100;
    const affected = errors.some(error => !Array.isArray(error?.path) || !error.path.length || (error.path[0] === alias && (typeof error.path[1] !== 'number' || error.path[1] === offset)));
    const nodes = data?.[alias];
    if (affected || !Array.isArray(nodes) || offset >= nodes.length) { unresolved.push(id); continue; }
    const value = nodes[offset];
    if (value === null) { deleted.push(id); continue; }
    const node = object(value);
    if (node?.id !== id || node.replyTo !== null || !sameScope(node.discussion, scope)) throw new Error('Ranking observation is outside its requested public discussion.');
    const parsed = candidate(node, inputs);
    if (parsed) candidates.push(parsed); else unresolved.push(id);
  }
  return { candidates, deleted, unresolved };
}
