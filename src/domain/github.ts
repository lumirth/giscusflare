import * as v from 'valibot';
import * as G from '../contracts/github.js';
import { parse, parseJSON, type Schema } from '../contracts/parse.js';
import { InstallationRecord } from '../contracts/storage.js';
import type { Widget, Selection } from '../contracts/requests.js';
import type { PublicConfig, SecretConfig } from '../contracts/config.js';
import type { User } from '../contracts/primitives.js';
import { appJWT, sha1 } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import type { FetchLike } from './platform.js';
import { Store } from './store.js';

export const GRAPH = {
  reactions: 'reactionGroups { content viewerHasReacted users { totalCount } }',
  scope: 'repository { id nameWithOwner isPrivate } category { id name }',
  page: 'totalCount pageInfo { startCursor endCursor hasNextPage hasPreviousPage }',
};
export const COMMENT = `isAnswer id body bodyHTML createdAt lastEditedAt url authorAssociation viewerDidAuthor viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize deletedAt isMinimized minimizedReason author { login avatarUrl url } replyTo { id } ${GRAPH.reactions}`;
export const IDENTITY = `id number ${GRAPH.scope}`;
export const ACCESS = `${IDENTITY} locked`;
export const TARGET_COMMENT = `id viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize replyTo { id } discussion { ${IDENTITY} }`;
export const SUMMARY = `id number title body bodyHTML url locked closed answer { id } ${GRAPH.scope} ${GRAPH.reactions}`;
const REPOSITORY = 'id nameWithOwner isPrivate isArchived discussionCategories(first:100) { nodes { id name isAnswerable } }';
export const QUERIES = {
  repository: 'query Repository($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { id nameWithOwner isPrivate isArchived discussionCategories(first:100) { nodes { id name isAnswerable } } } }',
  thread: `query Thread($owner:String!,$name:String!,$number:Int!,$first:Int,$last:Int,$after:String,$before:String,$replyPrefetch:Int!) { repository(owner:$owner,name:$name) { isPrivate discussion(number:$number) { ${SUMMARY} comments(first:$first,last:$last,after:$after,before:$before) { ${GRAPH.page} nodes { ${COMMENT} replies(last:$replyPrefetch) { ${GRAPH.page} nodes { ${COMMENT} } } } } } } }`,
  search: `query FindDiscussion($query:String!,$strict:Boolean!) { search(type:DISCUSSION,query:$query,first:10) { nodes { ... on Discussion { ${IDENTITY} body @include(if:$strict) } } } }`,
  access: `query DiscussionAccess($owner:String!,$name:String!,$number:Int!) { repository(owner:$owner,name:$name) { isPrivate discussion(number:$number) { ${ACCESS} } } }`,
  target: `query Target($id:ID!) { node(id:$id) { __typename ... on Discussion { ${IDENTITY} } ... on DiscussionComment { ${TARGET_COMMENT} } } }`,
  commentRefresh: `query CommentRefresh($id:ID!) { node(id:$id) { ... on DiscussionComment { ${COMMENT} discussion { ${IDENTITY} } } } }`,
  replies: `query Replies($id:ID!,$before:String) { node(id:$id) { ... on DiscussionComment { id replyTo { id } discussion { ${IDENTITY} } replies(last:50,before:$before) { ${GRAPH.page} nodes { ${COMMENT} } } } } }`,
};
export async function limitedText(response: Response, max = 4 * 1024 * 1024): Promise<string> {
  const reader = response.body?.getReader();
  requireCondition(reader, 502, 'UPSTREAM', 'GitHub returned an empty response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    requireCondition(Number(response.headers.get('Content-Length') || 0) <= max, 502, 'UPSTREAM', 'The GitHub response is too large to display safely. Open the discussion on GitHub.');
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      requireCondition(length <= max, 502, 'UPSTREAM', 'The GitHub response is too large to display safely. Open the discussion on GitHub.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result); }
  catch { throw new AppError(502, 'UPSTREAM_SCHEMA', 'GitHub returned invalid text.'); }
}
export class GitHub {
  #installation:{token:string;expires:number}|undefined;
  #deadlines = new WeakMap<Response, ReturnType<typeof setTimeout>>();
  async #text(response:Response,max?:number):Promise<string>{
    try{return await limitedText(response,max);}
    finally{const timer=this.#deadlines.get(response);if(timer!==undefined)clearTimeout(timer);this.#deadlines.delete(response);}
  }
  constructor(readonly repo: string, readonly config: PublicConfig, readonly keys: SecretConfig, readonly store: Store, readonly transport: FetchLike = request => fetch(request)) {}
  #scope(): { owner: string; name: string } { const [owner, name] = this.repo.split('/'); return { owner: owner!, name: name! }; }
  async #response(path: string, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, text = false): Promise<Response> {
    const headers = new Headers({ Accept: text ? 'text/html' : 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'User-Agent': 'giscusflare/1', 'X-GitHub-Api-Version': '2022-11-28' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try { response = await this.transport(new Request('https://api.github.com' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: abort.signal })); }
    catch { clearTimeout(timer); throw new AppError(502, 'WRITE_UNCERTAIN', 'The connection to GitHub ended before a response arrived.'); }
    if (response.ok) { this.#deadlines.set(response,timer); return response; }
    clearTimeout(timer);
    await response.body?.cancel().catch(() => undefined);
    if(response.status===401&&this.#installation?.token===token){this.#installation=undefined;this.store.delete('installation');}
    if (response.status === 401) throw new AppError(401, 'GITHUB_AUTH', 'GitHub authorization is no longer valid. Sign in again.');
    if (response.status === 429 || (response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After')))) {
      const seconds = Number(response.headers.get('Retry-After')) || Math.ceil(Number(response.headers.get('X-RateLimit-Reset')) - Date.now() / 1000) || 60;
      throw new AppError(429, 'RATE_LIMIT', 'GitHub is limiting requests. Try again later.', Math.min(3600, Math.max(1, seconds)));
    }
    if (response.status === 403) throw new AppError(403, 'PERMISSION', 'GitHub did not permit this operation.');
    if (response.status === 404) throw new AppError(404, 'NOT_FOUND', 'The GitHub resource is not accessible.');
    if ([400, 422].includes(response.status)) throw new AppError(400, 'BAD_INPUT', 'GitHub rejected the request. Check the content or repository settings.');
    throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub could not complete the request.');
  }
  async #rest<S extends Schema>(schema: S, path: string, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<v.InferOutput<S>> {
    const response = await this.#response(path, token, method, body);
    return parse(schema, parseJSON(await this.#text(response), 'upstream'), 'upstream');
  }
  async graph<S extends Schema>(schema: S, query: string, variables: Record<string, unknown>, token: string): Promise<v.InferOutput<S>> {
    const envelope = await this.#rest(G.GraphQLEnvelope, '/graphql', token, 'POST', { query, variables });
    if (envelope.errors?.length) {
      const codes = envelope.errors.map(e => e.type);
      if (codes.includes('RATE_LIMITED')) throw new AppError(429, 'RATE_LIMIT', 'GitHub rate limit reached.', 60);
      // Partial GraphQL mutations can have effects despite errors. Never treat an
      // arbitrary error envelope as proof that a mutation was not committed.
      if (query.trimStart().startsWith('mutation')) throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
      if (codes.includes('FORBIDDEN')) throw new AppError(403, 'PERMISSION', 'GitHub denied access to this discussion.');
      if (codes.includes('NOT_FOUND')) throw new AppError(404, 'NOT_FOUND', 'The discussion or comment was not found.');
      throw new AppError(502, 'UPSTREAM', 'GitHub could not load the discussion.');
    }
    return parse(schema, envelope.data, 'upstream');
  }
  /** Ranking handles field-level GraphQL errors without confusing them with deletions. */
  async rankingGraph(query:string,variables:Record<string,unknown>,token:string):Promise<unknown>{
    const payload=await this.#rest(G.GraphQLEnvelope,'/graphql',token,'POST',{query,variables});
    if(payload.errors?.some(error=>error.type==='RATE_LIMITED'))throw new AppError(429,'RATE_LIMIT','GitHub rate limit reached.',60);
    return payload;
  }
  async installation(beforeRenew?:()=>void): Promise<string> {
    if(this.#installation&&this.#installation.expires>this.store.now()+300000)return this.#installation.token;
    return this.store.lock('installation', async () => {
      if(this.#installation&&this.#installation.expires>this.store.now()+300000)return this.#installation.token;
      const recordKey = 'installation'; const context = `${this.config.appId}:${this.repo}`;
      try {
        const record = await this.store.secret(recordKey, InstallationRecord, this.keys.sessionSecret, context);
        if (record && record.expires > this.store.now() + 300000) {this.#installation=record;return record.token;}
      } catch { this.store.delete(recordKey); }
      beforeRenew?.();
      const jwt = await appJWT(this.config.appId, this.keys.privateKey, this.store.now());
      const installation = await this.#rest(G.Installation, `/repos/${this.repo}/installation`, jwt);
      const result = await this.#rest(G.InstallationToken, `/app/installations/${installation.id}/access_tokens`, jwt, 'POST', { repositories: [this.#scope().name], permissions: { discussions: 'write' } });
      const expires = Date.parse(result.expires_at);
      requireCondition(expires > this.store.now(), 502, 'UPSTREAM_SCHEMA', 'GitHub issued an expired installation token.');
      await this.store.putSecret(recordKey, InstallationRecord, { token: result.token, expires }, this.keys.sessionSecret, context, expires);
      this.#installation={token:result.token,expires};return result.token;
    });
  }
  async repository(token: string): Promise<G.Repository> {
    try {
      const result = await this.graph(G.RepositoryResponse, QUERIES.repository, this.#scope(), token);
      requireCondition(result.repository, 404, 'NOT_FOUND', 'The repository is not accessible to this GitHub App.');
      return result.repository;
    } catch (error) {
      if (error instanceof AppError && error.code === 'GITHUB_AUTH') {
        this.store.delete('installation'); throw new AppError(503, 'CONFIGURATION', 'Check the GitHub App installation and its Discussions permission.');
      }
      throw error;
    }
  }
  async find(config: Selection, category: string, token: string): Promise<G.DiscussionIdentity[]> {
    const term = config.strict ? await sha1(config.term) : config.term;
    const query = `repo:${this.repo} category:${JSON.stringify(category)} ${config.strict ? 'in:body' : 'in:title'} ${JSON.stringify(term)} sort:created-asc`;
    const match = v.object({ ...G.DiscussionIdentity.entries, body: config.strict ? G.DiscussionSummary.entries.body : v.optional(G.DiscussionSummary.entries.body) });
    const schema = v.object({ search: v.object({ nodes: v.pipe(v.array(v.nullable(match)), v.maxLength(10)) }) });
    const result = await this.graph(schema, QUERIES.search, { query, strict: config.strict }, token);
    return result.search.nodes.filter(node => node !== null).filter(d => !config.strict || d.body!.includes(term));
  }
  /** Batch minimal summaries. Search is only used until a mapping is known. */
  async counts(pages:{term:string;number:number|null}[],strict:boolean,category:string,token:string):Promise<{meta:G.Repository;summaries:(G.DiscussionCount|null)[]}>{
    const variables:Record<string,string|number>={...this.#scope()};
    const declarations=['$owner:String!','$name:String!'],known:string[]=[],searches:string[]=[];
    const terms=new Map<number,string>();
    for(const [i,page] of pages.entries()){
      if(page.number!==null){
        declarations.push('$n'+i+':Int!');variables['n'+i]=page.number;
        known.push('p'+i+':discussion(number:$n'+i+'){number '+GRAPH.scope+' comments{totalCount}}');
      }else{
        const term=strict?await sha1(page.term):page.term;terms.set(i,term);
        declarations.push('$q'+i+':String!');variables['q'+i]=`repo:${this.repo} category:${JSON.stringify(category)} ${strict?'in:body':'in:title'} ${JSON.stringify(term)} sort:created-asc`;
        searches.push('p'+i+':search(type:DISCUSSION,query:$q'+i+',first:10){nodes{... on Discussion{number '+(strict?'body ':'')+GRAPH.scope+' comments{totalCount}}}}');
      }
    }
    const query=`query CommentCounts(${declarations.join(',')}){repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussionCategories(first:100){nodes{id name isAnswerable}} ${known.join(' ')}} ${searches.join(' ')}}`;
    const data=await this.graph(v.record(v.string(),v.unknown()),query,variables,token);
    const meta=parse(G.Repository,data.repository,'upstream');
    const repository=data.repository as Record<string,unknown>;
    const summaries=pages.map((page,i)=>{
      if(page.number!==null){
        requireCondition(Object.hasOwn(repository,'p'+i),502,'UPSTREAM_SCHEMA','GitHub omitted a count result.');
        return repository['p'+i]===null?null:parse(G.DiscussionCount,repository['p'+i],'upstream');
      }
      const result=parse(v.object({nodes:v.pipe(v.array(v.nullable(v.object({...G.DiscussionCount.entries,body:strict?v.string():v.optional(v.string(),'')}))),v.maxLength(10))}),data['p'+i],'upstream');
      return result.nodes.find(d=>d&&(!strict||d.body.includes(terms.get(i)!)))??null;
    });
    return {meta,summaries};
  }
  async access(number: number, token: string): Promise<G.DiscussionAccess | null> {
    const data = await this.graph(G.DiscussionAccessResponse, QUERIES.access, { ...this.#scope(), number }, token);
    requireCondition(data.repository && !data.repository.isPrivate, 403, 'PUBLIC_ONLY', 'The configured repository must remain public.');
    return data.repository.discussion;
  }
  async thread(number: number, order: 'oldest' | 'newest', cursor: string, token: string, includeComments=true, replyPrefetch=5): Promise<G.Discussion | null> {
    const variables = { ...this.#scope(), number, replyPrefetch, first: order === 'oldest' ? (includeComments?20:0) : null, last: order === 'newest' ? (includeComments?20:0) : null, after: order === 'oldest' && cursor ? cursor : null, before: order === 'newest' && cursor ? cursor : null };
    const data = await this.graph(G.ThreadResponse, QUERIES.thread, variables, token);
    requireCondition(data.repository && !data.repository.isPrivate, 403, 'PUBLIC_ONLY', 'The configured repository must remain public.');
    return data.repository.discussion;
  }
  /** The installation credential validates scope and reads the page in one call. */
  async combinedThread(number:number, order:'oldest'|'newest',cursor:string,token:string,replyPrefetch:number,includeComments=true){
    const query=QUERIES.thread.replace('query Thread(', 'query CombinedThread(').replace(' { isPrivate discussion(number:',` { ${REPOSITORY} discussion(number:`);
    const data=await this.graph(G.CombinedThreadResponse,query,{...this.#scope(),number,replyPrefetch,first:order==='oldest'?(includeComments?20:0):null,last:order==='newest'?(includeComments?20:0):null,after:order==='oldest'&&cursor?cursor:null,before:order==='newest'&&cursor?cursor:null},token);
    requireCondition(data.repository,404,'NOT_FOUND','The repository is not accessible to this GitHub App.');
    return data.repository;
  }
  async hydrate(ids:string[],token:string,replyPrefetch:number):Promise<(G.RootComment & {discussion:G.DiscussionIdentity}|null)[]>{
    const schema=v.object({nodes:v.array(v.nullable(v.object({...G.RootComment.entries,discussion:G.DiscussionIdentity})))});
    const data=await this.graph(schema,`query Hydrate($ids:[ID!]!,$replyPrefetch:Int!){nodes(ids:$ids){... on DiscussionComment{${COMMENT} discussion{${IDENTITY}} replies(last:$replyPrefetch){${GRAPH.page} nodes{${COMMENT}}}}}}`,{ids,replyPrefetch},token);
    requireCondition(data.nodes.length===ids.length,502,'UPSTREAM_SCHEMA','GitHub omitted a requested comment.');return data.nodes;
  }
  async target(id: string, token: string): Promise<G.Target> {
    const result = await this.graph(G.TargetResponse, QUERIES.target, { id }, token);
    requireCondition(result.node, 404, 'NOT_FOUND', 'Comment or discussion not found.'); return result.node;
  }
  async commentRefresh(id: string, token: string): Promise<G.CommentRefresh> {
    const result = await this.graph(G.CommentRefreshResponse, QUERIES.commentRefresh, { id }, token);
    requireCondition(result.node, 404, 'NOT_FOUND', 'Comment not found.');
    return result.node;
  }
  async replies(parentId: string, cursor: string, token: string): Promise<v.InferOutput<typeof G.RepliesResponse>['node']> {
    const result = await this.graph(G.RepliesResponse, QUERIES.replies, { id: parentId, before: cursor || null }, token);
    requireCondition(result.node, 404, 'NOT_FOUND', 'Reply thread not found.'); return result.node;
  }
  async create(widget: Selection & Partial<Pick<Widget,'description'|'backLink'>>, repositoryId: string, categoryId: string, token: string): Promise<{ id: string; number: number }> {
    const page = new URL(widget.backLink || widget.origin); page.hash = ''; page.searchParams.delete('giscus');
    const body = `# ${widget.term}\n\n${widget.description||''}\n\n${page.toString()}\n\n<!-- sha1: ${await sha1(widget.term)} -->`;
    const data = await this.graph(G.CreateResponse, 'mutation CreateDiscussion($input:CreateDiscussionInput!) { createDiscussion(input:$input) { discussion { id number } } }', { input: { repositoryId, categoryId, title: widget.term, body } }, token);
    return data.createDiscussion.discussion;
  }
  async comment(discussionId: string, body: string, replyToId: string, token: string): Promise<G.Comment> {
    const data = await this.graph(G.AddCommentResponse, `mutation AddComment($input:AddDiscussionCommentInput!) { addDiscussionComment(input:$input) { comment { ${COMMENT} } } }`, { input: { discussionId, body, ...(replyToId ? { replyToId } : {}) } }, token);
    return data.addDiscussionComment.comment;
  }
  async edit(id: string, body: string, token: string): Promise<G.Comment> {
    const data = await this.graph(G.EditResponse, `mutation EditComment($input:UpdateDiscussionCommentInput!) { updateDiscussionComment(input:$input) { comment { ${COMMENT} } } }`, { input: { commentId: id, body } }, token);
    return data.updateDiscussionComment.comment;
  }
  async remove(id: string, token: string): Promise<G.Comment | null> {
    const data = await this.graph(G.DeleteResponse, `mutation DeleteComment($input:DeleteDiscussionCommentInput!) { deleteDiscussionComment(input:$input) { comment { ${COMMENT} } } }`, { input: { id } }, token);
    return data.deleteDiscussionComment.comment;
  }
  async react(id: string, reaction: string, add: boolean, token: string): Promise<v.InferOutput<typeof G.ReactionSubject>> {
    const input = { subjectId: id, content: reaction };
    if (add) return (await this.graph(G.AddReactionResponse, `mutation React($input:AddReactionInput!) { addReaction(input:$input) { subject { id ${GRAPH.reactions} } } }`, { input }, token)).addReaction.subject;
    return (await this.graph(G.RemoveReactionResponse, `mutation Unreact($input:RemoveReactionInput!) { removeReaction(input:$input) { subject { id ${GRAPH.reactions} } } }`, { input }, token)).removeReaction.subject;
  }
  async moderate(id: string, minimized: boolean, token: string, reason: string): Promise<void> {
    if (minimized) await this.graph(G.MinimizeResponse, 'mutation Minimize($input:MinimizeCommentInput!) { minimizeComment(input:$input) { clientMutationId } }', { input: { subjectId: id, classifier: reason } }, token);
    else await this.graph(G.UnminimizeResponse, 'mutation Unminimize($input:UnminimizeCommentInput!) { unminimizeComment(input:$input) { clientMutationId } }', { input: { subjectId: id } }, token);
  }
  async markdown(text: string, token: string): Promise<string> {
    const response = await this.#response('/markdown', token, 'POST', { mode: 'gfm', context: this.repo, text }, true);
    return this.#text(response);
  }
  async exchange(parameters: Record<string, string>): Promise<G.OAuthToken> {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await this.transport(new Request('https://github.com/login/oauth/access_token', {
        method:'POST',headers:{Accept:'application/json','User-Agent':'giscusflare/1'},
        body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.keys.clientSecret,...parameters}),
        redirect:'manual',signal:abort.signal,
      }));
      if(!response.ok){await response.body?.cancel();throw new AppError(502,'OAUTH','GitHub sign-in could not be completed.');}
      const raw=parseJSON(await limitedText(response,16384),'upstream');
      if(v.is(v.object({error:v.string()}),raw))throw new AppError(401,'GITHUB_AUTH','GitHub did not authorize this session. Sign in again.');
      return parse(G.OAuthToken,raw,'upstream');
    }catch(error){
      if(error instanceof AppError)throw error;
      throw new AppError(502,'OAUTH','GitHub sign-in failed. Start again.');
    }finally{clearTimeout(timer);}
  }
  async viewer(token: string): Promise<User> {
    const user = await this.#rest(G.Viewer, '/user', token);
    return { login: user.login, avatarUrl: user.avatar_url, url: user.html_url };
  }
}
