import * as v from 'valibot';
import * as G from '../contracts/github.js';
import { parse, parseJSON, type Schema } from '../contracts/parse.js';
import { InstallationRecord } from '../contracts/storage.js';
import type { Widget, Selection, PageRequest, Action } from '../contracts/requests.js';
import type { Comment, Discussion, Reactions, Window, WindowPage, Patch } from '../contracts/document.js';
import type { PublicConfig, SecretConfig } from '../contracts/config.js';
import { User, NodeID } from '../contracts/primitives.js';
import { appJWT, sha1 } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import { Store } from './store.js';
import { bodyBytes } from './body.js';
const Viewer = v.object({ ...User.entries, id: NodeID });
export const GRAPH = {
    reactions: 'reactionGroups { content viewerHasReacted reactors(first:1) { totalCount } }',
    scope: 'repository { id nameWithOwner isPrivate } category { id name }',
    page: 'totalCount pageInfo { startCursor endCursor hasNextPage hasPreviousPage }',
};
export const COMMENT = `upvoteCount id body bodyHTML createdAt lastEditedAt url authorAssociation viewerDidAuthor viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize deletedAt isMinimized minimizedReason author { login avatarUrl url } replyTo { id } ${GRAPH.reactions}`;
export const IDENTITY = `id number ${GRAPH.scope}`;
export const ACCESS = `${IDENTITY} locked`;
export const REPOSITORY = 'id nameWithOwner isPrivate isArchived discussionCategories(first:100) { nodes { id name } }';
export const QUERIES = {
    repository: `query Repository($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { ${REPOSITORY} } }`,
};
function reactions(groups: G.Comment['reactionGroups']): Reactions {
    return Object.fromEntries(groups.map(g => [g.content, { count: g.reactors.totalCount, selected: g.viewerHasReacted }]));
}
function node(raw: G.Comment & Partial<Pick<G.RootComment, 'replies' | 'discussion'>>): Comment {
    const { reactionGroups, replyTo, upvoteCount, replies, discussion, ...value } = raw;
    return { ...value, parentId: replyTo?.id ?? null, reactions: reactions(reactionGroups), upvotes: upvoteCount };
}
function window(connection: G.Replies, order: 'oldest' | 'newest',unobserved=false): Window {
    const p = connection.pageInfo;
    return { ids: connection.nodes.map(n => n.id), total: connection.totalCount, cursor: unobserved&&connection.totalCount>0?'':order === 'oldest' ? (p.hasNextPage ? p.endCursor : null) : (p.hasPreviousPage ? p.startCursor : null) };
}
export type AcquisitionRequest = Pick<PageRequest, 'order' | 'cursor' | 'parentId' | 'ids' | 'replyPrefetch'> & { html: boolean; operation?: Action };
export interface OperationTarget { id: string; parentId: string | null; url: string; viewerCanUpdate: boolean; viewerCanDelete: boolean; viewerCanMinimize: boolean; viewerCanUnminimize: boolean }
export interface AcquiredPage {
    target?: OperationTarget;
    repository: G.RepositoryHead;
    category: {
        id: string;
        name: string;
    } | undefined;
    discussion: Discussion | null;
    viewer: v.InferOutput<typeof Viewer>|null;
    page: WindowPage;
}
export async function limitedText(response: Response, max = 4 * 1024 * 1024): Promise<string> {
    const oversized = new AppError(502, 'UPSTREAM', 'The GitHub response is too large to display safely. Open the discussion on GitHub.');
    if (response.body && !(Number(response.headers.get('Content-Length') || 0) <= max)) {
        await response.body?.cancel().catch(() => undefined);
        throw oversized;
    }
    const result = await bodyBytes(response.body, max, new AppError(502, 'UPSTREAM', 'GitHub returned an empty response.'), oversized);
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result);
    }
    catch {
        throw new AppError(502, 'UPSTREAM_SCHEMA', 'GitHub returned invalid text.');
    }
}
/** One bounded transport for API, OAuth and pre-allocation admission. The
 * deadline owns body consumption as well as header acquisition. */
async function githubText(url: string, init: RequestInit, maximum = 4 * 1024 * 1024): Promise<string> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
        const response = await fetch(new Request(url, { ...init, redirect: 'manual', signal: abort.signal }));
        if (response.ok)
            return await limitedText(response, maximum);
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401)
            throw new AppError(401, 'GITHUB_AUTH', 'GitHub authorization is no longer valid. Sign in again.');
        if (response.status === 429 || (response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || response.headers.has('Retry-After')))) {
            const seconds = Number(response.headers.get('Retry-After')) || Math.ceil(Number(response.headers.get('X-RateLimit-Reset')) - Date.now() / 1000) || 60;
            throw new AppError(429, 'RATE_LIMIT', 'GitHub is limiting requests. Try again later.', Math.min(3600, Math.max(1, seconds)));
        }
        if (response.status === 403)
            throw new AppError(403, 'PERMISSION', 'GitHub did not permit this operation.');
        if (response.status === 404)
            throw new AppError(404, 'NOT_FOUND', 'The GitHub resource is not accessible.');
        if ([400, 422].includes(response.status))
            throw new AppError(400, 'BAD_INPUT', 'GitHub rejected the request. Check the content or repository settings.');
        throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub could not complete the request.');
    }
    catch (error) {
        if (error instanceof AppError)
            throw error;
        throw new AppError(502, 'WRITE_UNCERTAIN', 'The connection to GitHub ended before a complete response arrived.');
    }
    finally {
        clearTimeout(timer);
    }
}
const apiHeaders = (token: string) => ({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'User-Agent': 'giscusflare/5', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' });
/** Verify an installed public repository before creating any Durable Object.
 * Uses App authentication and the same transport/schema boundary as operations. */
export async function installedRepository(repo: string, config: PublicConfig, keys: SecretConfig): Promise<string> {
    const token = await appJWT(config.appId, keys.privateKey, Date.now());
    const read = async (path: string, body?: unknown) => parseJSON(await githubText('https://api.github.com' + path, {
        method: body === undefined ? 'GET' : 'POST', headers: apiHeaders(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, 262144), 'upstream');
    const installation = parse(G.Installation, await read('/repos/' + repo + '/installation'), 'upstream');
    const schema = v.object({ repositories: v.tuple([v.object({ private: v.boolean(), node_id: G.RepositoryHead.entries.id, full_name: v.string() })]) });
    const result = parse(schema, await read('/app/installations/' + installation.id + '/access_tokens', { repositories: [repo.split('/')[1]], permissions: { metadata: 'read' } }), 'upstream');
    const repository = result.repositories[0];
    requireCondition(!repository.private && repository.full_name.toLowerCase() === repo, 403, 'PUBLIC_ONLY', 'Use the canonical name of a public repository with this GitHub App installed.');
    return repository.node_id;
}
export class GitHub {
    #installation: {
        token: string;
        expires: number;
    } | undefined;
    constructor(readonly repo:string,readonly repositoryId:string,readonly config:PublicConfig,readonly keys:SecretConfig,readonly store:Store) { }
    #scope(): {
        owner: string;
        name: string;
    } { const [owner, name] = this.repo.split('/'); return { owner: owner!, name: name! }; }
    async #response(path: string, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, text = false): Promise<string> {
        try {
            return await githubText('https://api.github.com' + path, { method, headers: { ...apiHeaders(token), ...(text ? { Accept: 'text/html' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        }
        catch (error) {
            if (error instanceof AppError && error.code === 'GITHUB_AUTH' && this.#installation?.token === token) {
                this.#installation = undefined;
                this.store.delete('installation');
            }
            throw error;
        }
    }
    async #rest<S extends Schema>(schema: S, path: string, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<v.InferOutput<S>> {
        const response = await this.#response(path, token, method, body);
        return parse(schema, parseJSON(response, 'upstream'), 'upstream');
    }
    async graph<S extends Schema>(schema: S, query: string, variables: Record<string, unknown>, token: string, missingNodes = false): Promise<v.InferOutput<S>> {
        const envelope = await this.#rest(G.GraphQLEnvelope, '/graphql', token, 'POST', { query, variables });
        const errors = envelope.errors?.filter(error => !(missingNodes && error.type === 'NOT_FOUND' && error.path?.[0] === 'nodes' && typeof error.path[1] === 'number' && error.path.length === 2 && Array.isArray(Object(envelope.data).nodes) && Object(envelope.data).nodes[error.path[1]] === null));
        if (errors?.length) {
            const codes = errors.map(e => e.type);
            // Partial GraphQL mutations can have effects despite errors. Never treat an
            // arbitrary error envelope as proof that a mutation was not committed.
            if (query.trimStart().startsWith('mutation'))
                throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
            if (codes.includes('RATE_LIMITED'))
                throw new AppError(429, 'RATE_LIMIT', 'GitHub rate limit reached.', 60);
            if (codes.includes('FORBIDDEN'))
                throw new AppError(403, 'PERMISSION', 'GitHub denied access to this discussion.');
            if (codes.includes('BAD_USER_INPUT'))
                throw new AppError(400, 'BAD_INPUT', 'GitHub rejected the reading cursor. Restart the discussion traversal.');
            if (codes.includes('NOT_FOUND'))
                throw new AppError(404, 'NOT_FOUND', 'The discussion or comment was not found.');
            throw new AppError(502, 'UPSTREAM', 'GitHub could not load the discussion.');
        }
        return parse(schema, envelope.data, 'upstream');
    }
    /** Ranking handles field-level GraphQL errors without confusing them with deletions. */
    async rankingGraph(query: string, variables: Record<string, unknown>, token: string): Promise<unknown> {
        const payload = await this.#rest(G.GraphQLEnvelope, '/graphql', token, 'POST', { query, variables });
        if (payload.errors?.some(error => error.type === 'RATE_LIMITED'))
            throw new AppError(429, 'RATE_LIMIT', 'GitHub rate limit reached.', 60);
        return payload;
    }
    async installation(beforeRenew?: () => void): Promise<string> {
        if (this.#installation && this.#installation.expires > this.store.now() + 300000)
            return this.#installation.token;
        return this.store.lock('installation', async () => {
            if (this.#installation && this.#installation.expires > this.store.now() + 300000)
                return this.#installation.token;
            const recordKey = 'installation';
            const context = `${this.config.appId}:${this.repositoryId}`;
            try {
                const record = await this.store.secret(recordKey, InstallationRecord, this.keys.sessionSecret, context);
                if (record && record.expires > this.store.now() + 300000) {
                    this.#installation = record;
                    return record.token;
                }
            }
            catch {
                this.store.delete(recordKey);
            }
            beforeRenew?.();
            const jwt = await appJWT(this.config.appId, this.keys.privateKey, this.store.now());
            const installation = await this.#rest(G.Installation, `/repos/${this.repo}/installation`, jwt);
            const result = await this.#rest(G.InstallationToken, `/app/installations/${installation.id}/access_tokens`, jwt, 'POST', { repositories: [this.#scope().name], permissions: { discussions: 'write' } });
            const expires = Date.parse(result.expires_at);
            requireCondition(expires > this.store.now(), 502, 'UPSTREAM_SCHEMA', 'GitHub issued an expired installation token.');
            await this.store.putSecret(recordKey, InstallationRecord, { token: result.token, expires }, this.keys.sessionSecret, context, expires);
            this.#installation = { token: result.token, expires };
            return result.token;
        });
    }
    async repository(token: string): Promise<G.Repository> {
        try {
            const result = await this.graph(G.RepositoryResponse, QUERIES.repository, this.#scope(), token);
            requireCondition(result.repository, 404, 'NOT_FOUND', 'The repository is not accessible to this GitHub App.');
            return result.repository;
        }
        catch (error) {
            if (error instanceof AppError && error.code === 'GITHUB_AUTH') {
                this.store.delete('installation');
                throw new AppError(503, 'CONFIGURATION', 'Check the GitHub App installation and its Discussions permission.');
            }
            throw error;
        }
    }
    /** An unknown term needs catalogue identity and minimal search results once. */
    async resolve(config:Selection,category:string,token:string,signedIn=false) {
        const term = config.strict ? await sha1(config.term) : config.term;
        const query = `repo:${this.repo} category:${JSON.stringify(category)} ${config.strict ? 'in:body' : 'in:title'} ${JSON.stringify(term)} sort:created-asc`;
        const match = v.object({ ...G.DiscussionIdentity.entries, body: v.optional(v.string(), '') });
        const schema=v.object({viewer:signedIn?Viewer:v.optional(Viewer),repository:v.nullable(G.Repository),search:v.object({nodes:v.array(v.nullable(match))})});
        const data = await this.graph(schema, `query ResolvePage($owner:String!,$name:String!,$query:String!,$strict:Boolean!,$signedIn:Boolean!){viewer @include(if:$signedIn){id login avatarUrl url} repository(owner:$owner,name:$name){${REPOSITORY}} search(type:DISCUSSION,query:$query,first:10){nodes{... on Discussion{${IDENTITY} body @include(if:$strict)}}}}`, { ...this.#scope(), query,strict:config.strict,signedIn},token);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        const selected = data.search.nodes.find(d => d && (!config.strict || d.body.includes(term))) ?? null;
        return {repository:data.repository,selected,viewer:data.viewer??null};
    }
    /** Batch minimal summaries. Search is only used until a mapping is known. */
    async counts(pages: {
        term: string;
        number: number | null;
    }[], strict: boolean, category: string, token: string): Promise<{
        meta: G.Repository;
        summaries: (G.DiscussionCount | null)[];
    }> {
        const variables: Record<string, string | number> = { ...this.#scope() };
        const declarations = ['$owner:String!', '$name:String!'], known: string[] = [], searches: string[] = [];
        const terms = new Map<number, string>();
        for (const [i, page] of pages.entries()) {
            if (page.number !== null) {
                declarations.push('$n' + i + ':Int!');
                variables['n' + i] = page.number;
                known.push('p' + i + ':discussion(number:$n' + i + '){number ' + GRAPH.scope + ' comments(first:1){totalCount}}');
            }
            else {
                const term = strict ? await sha1(page.term) : page.term;
                terms.set(i, term);
                declarations.push('$q' + i + ':String!');
                variables['q' + i] = `repo:${this.repo} category:${JSON.stringify(category)} ${strict ? 'in:body' : 'in:title'} ${JSON.stringify(term)} sort:created-asc`;
                searches.push('p' + i + ':search(type:DISCUSSION,query:$q' + i + ',first:10){nodes{... on Discussion{number ' + (strict ? 'body ' : '') + GRAPH.scope + ' comments(first:1){totalCount}}}}');
            }
        }
        const query = `query CommentCounts(${declarations.join(',')}){repository(owner:$owner,name:$name){${REPOSITORY} ${known.join(' ')}} ${searches.join(' ')}}`;
        const data = await this.graph(v.record(v.string(), v.unknown()), query, variables, token);
        const meta = parse(G.Repository, data.repository, 'upstream');
        const repository = data.repository as Record<string, unknown>;
        const summaries = pages.map((page, i) => {
            if (page.number !== null) {
                requireCondition(Object.hasOwn(repository, 'p' + i), 502, 'UPSTREAM_SCHEMA', 'GitHub omitted a count result.');
                return repository['p' + i] === null ? null : parse(G.DiscussionCount, repository['p' + i], 'upstream');
            }
            const result = parse(v.object({ nodes: v.pipe(v.array(v.nullable(v.object({ ...G.DiscussionCount.entries, body: strict ? v.string() : v.optional(v.string(), '') }))), v.maxLength(10)) }), data['p' + i], 'upstream');
            return result.nodes.find(d => d && (!strict || d.body.includes(terms.get(i)!))) ?? null;
        });
        return { meta, summaries };
    }
    /** One physical query acquires the selected document window and its scope. */
    async page(number: number, request: AcquisitionRequest, token:string,signedIn=false):Promise<AcquiredPage>{
        if (request.operation) return this.#operationAccess(number, request.operation, token);
        const root = !request.parentId && request.ids === undefined;
        const fields = COMMENT.replace('bodyHTML', 'bodyHTML @include(if:$html)');
        const comment = `${fields} discussion{${IDENTITY}} replies(last:$prefetch){${GRAPH.page} nodes @include(if:$previewReplies){${fields}}}`;
        const summary = `id number title url locked closed answer{id} ${GRAPH.scope} ${GRAPH.reactions}`;
        const query = `query Page($owner:String!,$name:String!,$number:Int!,$first:Int,$last:Int,$after:String,$before:String,$prefetch:Int!,$previewReplies:Boolean!,$roots:Boolean!,$ids:[ID!]!,$selected:Boolean!,$parent:ID!,$reply:Boolean!,$replyBefore:String,$signedIn:Boolean!,$html:Boolean!){
      viewer @include(if:$signedIn){id login avatarUrl url}
      repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussion(number:$number){${summary} comments(first:$first,last:$last,after:$after,before:$before){${GRAPH.page} nodes @include(if:$roots){${comment}}}}}
      nodes(ids:$ids) @include(if:$selected){... on DiscussionComment{${comment}}}
      parent:node(id:$parent) @include(if:$reply){... on DiscussionComment{${fields} discussion{${IDENTITY}} replies(last:50,before:$replyBefore){${GRAPH.page} nodes{${fields}}}}}
    }`;
        const preview=v.object({...G.Replies.entries,nodes:request.replyPrefetch>0?G.Replies.entries.nodes:v.optional(G.Replies.entries.nodes,[])});
        const observed=v.object({...G.Comment.entries,discussion:G.DiscussionIdentity,replies:preview});
        const roots=v.pipe(v.array(observed),v.maxLength(20)),selected=v.array(v.nullable(observed));
        const connection=v.object({...G.Replies.entries,nodes:root?roots:v.optional(roots,[])});
        const schema=v.object({viewer:signedIn?Viewer:v.optional(Viewer),repository:v.nullable(v.object({...G.RepositoryHead.entries,discussion:v.nullable(v.object({...G.DiscussionSummary.entries,comments:connection}))})),nodes:request.ids!==undefined?selected:v.optional(selected),parent:request.parentId?v.nullable(G.RootComment):v.optional(v.nullable(G.RootComment))});
        const data = await this.graph(schema, query, { ...this.#scope(), number, roots: root, first: root && request.order === 'oldest' ? 20 : root ? null : 1, last: root && request.order === 'newest' ? 20 : null, after: root && request.order === 'oldest' && request.cursor ? request.cursor : null, before: root && request.order === 'newest' && request.cursor ? request.cursor : null, replyBefore: request.parentId && request.cursor ? request.cursor : null, prefetch: Math.max(1,request.replyPrefetch), previewReplies:request.replyPrefetch>0, ids: request.ids ?? [], selected: request.ids !== undefined, parent: request.parentId ?? 'unused', reply:Boolean(request.parentId),signedIn,html:request.html},token, request.ids !== undefined);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        const { discussion: raw, ...repository } = data.repository;
        if (raw)
            requireCondition(raw.repository.id === repository.id && !raw.repository.isPrivate && raw.repository.nameWithOwner.toLowerCase() === this.repo, 403, 'PUBLIC_ONLY', 'This discussion is outside the configured repository.');
        const nodes: Record<string, Comment> = {}, replies: Record<string, Window> = {};
        const accept = (item: G.RootComment) => {
            requireCondition(raw && item.discussion.id === raw.id && item.discussion.repository.id === repository.id && !item.discussion.repository.isPrivate && item.discussion.repository.nameWithOwner.toLowerCase() === this.repo && item.discussion.category.id === raw.category.id, 403, 'PERMISSION', 'The requested comment is outside this page.');
            nodes[item.id] = node(item);
            if (!item.replyTo) {
                replies[item.id] = window(item.replies,'newest',!request.parentId&&request.replyPrefetch===0);
                for (const reply of item.replies.nodes) {
                    requireCondition(reply.replyTo?.id === item.id, 502, 'UPSTREAM_SCHEMA', 'GitHub returned replies for another comment.');
                    nodes[reply.id] = node({ ...reply, replies: { totalCount: 0, nodes: [], pageInfo: item.replies.pageInfo }, discussion: item.discussion });
                }
            }
        };
        let acquired: Window = { ids: [], total: raw?.comments.totalCount ?? 0, cursor: null };
        if (root && raw) {
            for (const item of raw.comments.nodes)
                accept(item);
            acquired = window(raw.comments, request.order);
        }
        if (request.ids) {
            requireCondition(data.nodes?.length === request.ids.length, 502, 'UPSTREAM_SCHEMA', 'GitHub omitted a requested comment.');
            for (const [i, item] of data.nodes!.entries())
                if (item) {
                    requireCondition(item.id === request.ids[i], 502, 'UPSTREAM_SCHEMA', 'GitHub returned another comment.');
                    accept(item);
                    if (!acquired.ids.includes(item.id))
                        acquired.ids.push(item.id);
                }
        }
        if (request.parentId) {
            const parent = data.parent;
            requireCondition(parent && parent.id === request.parentId && !parent.replyTo, 404, 'NOT_FOUND', 'Reply thread not found.');
            accept(parent);
            acquired = window(parent.replies, 'newest');
        }
        const thread: Discussion | null = raw ? { id: raw.id, number: raw.number, title: raw.title, url: raw.url, locked: raw.locked, closed: raw.closed, answerId: raw.answer?.id ?? null, reactions: reactions(raw.reactionGroups) } : null;
        return { repository, category:raw?.category,discussion:thread,viewer:data.viewer??null,page: { nodes, window: acquired, replies } };
    }
    async repositoryHead(token: string): Promise<G.RepositoryHead> {
        const data = await this.graph(v.object({ repository: v.nullable(G.RepositoryHead) }), `query RepositoryHead($owner:String!,$name:String!){repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived}}`, this.#scope(), token);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        return data.repository;
    }
    async create(widget: Selection & Partial<Pick<Widget, 'description' | 'backLink'>>, repositoryId: string, categoryId: string, token: string): Promise<G.DiscussionAccess> {
        const page = new URL(widget.backLink || widget.origin);
        page.hash = '';
        page.searchParams.delete('giscus');
        const body = `# ${widget.term}\n\n${widget.description || ''}\n\n${page.toString()}\n\n<!-- sha1: ${await sha1(widget.term)} -->`;
        const data = await this.graph(G.CreateResponse, `mutation CreateDiscussion($input:CreateDiscussionInput!) { createDiscussion(input:$input) { discussion { ${ACCESS} } } }`, { input: { repositoryId, categoryId, title: widget.term, body } }, token);
        return data.createDiscussion.discussion;
    }
    /** Scope and permission preflight does not acquire the target's Markdown or rich content. */
    async #operationAccess(number: number, action: Action, token: string): Promise<AcquiredPage> {
        const targetId = action.type === 'comment' ? action.replyToId
            : action.type === 'reaction' ? action.subject.kind === 'comment' ? action.subject.id : '' : action.id;
        const summary = `id number title url locked closed answer{id} ${GRAPH.scope} ${GRAPH.reactions}`;
        const targetSchema = v.object({ id: NodeID, url: G.Comment.entries.url, replyTo: G.Comment.entries.replyTo,
            viewerCanUpdate: v.boolean(), viewerCanDelete: v.boolean(), viewerCanMinimize: v.boolean(), viewerCanUnminimize: v.boolean(), discussion: G.DiscussionIdentity });
        const data = await this.graph(v.object({ repository: v.nullable(v.object({ ...G.RepositoryHead.entries, discussion: v.nullable(G.DiscussionSummary) })),
            target: v.optional(v.nullable(targetSchema)) }),
            `query OperationAccess($owner:String!,$name:String!,$number:Int!,$target:ID!,$selected:Boolean!){repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussion(number:$number){${summary}}} target:node(id:$target) @include(if:$selected){... on DiscussionComment{id url replyTo{id} viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize discussion{${IDENTITY}}}}}`,
            { ...this.#scope(), number, target: targetId || 'unused', selected: Boolean(targetId) }, token);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        const { discussion: raw, ...repository } = data.repository;
        if (raw) requireCondition(raw.repository.id === repository.id && !raw.repository.isPrivate && raw.repository.nameWithOwner.toLowerCase() === this.repo, 403, 'PUBLIC_ONLY', 'This discussion is outside the configured repository.');
        const target = data.target;
        if (target) requireCondition(target.id === targetId && raw && target.discussion.id === raw.id && target.discussion.repository.id === repository.id && !target.discussion.repository.isPrivate && target.discussion.category.id === raw.category.id, 403, 'PERMISSION', 'The requested comment is outside this page.');
        return { repository, category: raw?.category,
            discussion: raw ? { id: raw.id, number: raw.number, title: raw.title, url: raw.url, locked: raw.locked, closed: raw.closed, answerId: raw.answer?.id ?? null, reactions: reactions(raw.reactionGroups) } : null,
            viewer: null, page: { nodes: {}, window: { ids: [], cursor: null, total: null }, replies: {} },
            ...(target ? { target: { id: target.id, url: target.url, parentId: target.replyTo?.id ?? null, viewerCanUpdate: target.viewerCanUpdate, viewerCanDelete: target.viewerCanDelete, viewerCanMinimize: target.viewerCanMinimize, viewerCanUnminimize: target.viewerCanUnminimize } } : {}) };
    }
    /** Mutation selection returns only confirmed fields owned by this operation. */
    async contribute(action: Action, discussionId: string, targetId: string, parentId: string, token: string, html = false): Promise<{ id: string; patch?: Patch }> {
        let query: string, input: Record<string, unknown>, field: string, item: string, inputType: string, fields: string;
        switch (action.type) {
            case 'comment':
                field = 'addDiscussionComment'; item = 'comment'; query = 'AddComment'; inputType = 'AddDiscussionCommentInput';
                input = { discussionId, body: action.body, ...(parentId ? { replyToId: parentId } : {}) };
                fields = COMMENT.replace('bodyHTML', html ? 'bodyHTML' : '') + ' discussion{id number comments(first:1){totalCount}} replyTo{id replies(first:1){totalCount}}';
                break;
            case 'edit':
                field = 'updateDiscussionComment'; item = 'comment'; query = 'EditComment'; inputType = 'UpdateDiscussionCommentInput';
                input = { commentId: targetId, body: action.body };
                fields = 'id body lastEditedAt url replyTo{id}' + (html ? ' bodyHTML' : '');
                break;
            case 'delete':
                field = 'deleteDiscussionComment'; item = 'comment'; query = 'DeleteComment'; inputType = 'DeleteDiscussionCommentInput';
                input = { id: targetId }; fields = 'id body deletedAt author{login avatarUrl url} viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize';
                break;
            case 'reaction':
                field = action.selected ? 'addReaction' : 'removeReaction'; item = 'subject'; query = action.selected ? 'React' : 'Unreact';
                inputType = action.selected ? 'AddReactionInput' : 'RemoveReactionInput'; input = { subjectId: targetId, content: action.reaction };
                fields = `id ${GRAPH.reactions}`;
                break;
            case 'moderate':
                field = action.minimized ? 'minimizeComment' : 'unminimizeComment'; item = action.minimized ? 'minimizedComment' : 'unminimizedComment'; query = action.minimized ? 'Minimize' : 'Unminimize';
                inputType = action.minimized ? 'MinimizeCommentInput' : 'UnminimizeCommentInput';
                input = { subjectId: targetId, ...(action.minimized ? { classifier: action.reason } : {}) };
                fields = '... on DiscussionComment{id isMinimized minimizedReason}';
                break;
        }
        const confirmation = action.type === 'moderate' ? '... on DiscussionComment{id}' : 'id';
        const envelope = await this.#rest(G.GraphQLEnvelope, '/graphql', token, 'POST', {
            query: `mutation ${query}($input:${inputType}!){effect:${field}(input:$input){identity:${item}{${confirmation}} display:${item}{${fields}}}}`, variables: { input },
        });
        const data = parse(v.object({ effect: v.object({ identity: v.nullable(v.object({ id: NodeID })), display: v.optional(v.nullable(v.record(v.string(), v.unknown()))) }) }), envelope.data, 'upstream');
        // Field-level errors can invalidate display data without invalidating the effect identity.
        requireCondition(data.effect.identity || action.type === 'delete' && !envelope.errors?.length, 502, 'WRITE_UNCERTAIN', 'GitHub did not confirm the changed identity.');
        const raw = data.effect.display, id = data.effect.identity?.id ?? targetId;
        requireCondition(action.type === 'comment' || id === targetId, 502, 'WRITE_UNCERTAIN', 'GitHub returned another changed identity.');
        try {
            requireCondition(!raw || raw.id === id, 502, 'UPSTREAM_SCHEMA', 'GitHub returned another display identity.');
            if (action.type === 'reaction') {
                const groups = raw!.reactionGroups;
                requireCondition(Array.isArray(groups), 502, 'UPSTREAM_SCHEMA', 'GitHub did not supply reaction observations.');
                const selected = groups.find(group => Object(group).content === action.reaction);
                if (!selected) requireCondition(!envelope.errors?.length && groups.every(group => group && typeof group.content === 'string'), 502, 'UPSTREAM_SCHEMA', 'GitHub did not fully observe this reaction.');
                const group = selected ? reactions([parse(G.ReactionGroup, selected, 'upstream')])[action.reaction]! : { count: 0, selected: false };
                return { id, patch: { reactions: { [id]: { [action.reaction]: group } } } };
            }
            if (action.type === 'delete') {
                if (data.effect.identity) requireCondition(raw, 502, 'UPSTREAM_SCHEMA', 'GitHub did not observe the retained comment.');
                if (raw) {
                    const tombstone = parse(v.object({ body: G.Comment.entries.body, deletedAt: G.Comment.entries.deletedAt, author: G.Comment.entries.author,
                        viewerCanUpdate: v.boolean(), viewerCanDelete: v.boolean(), viewerCanMinimize: v.boolean(), viewerCanUnminimize: v.boolean() }), raw, 'upstream');
                    return { id, patch: { nodes: { [id]: tombstone } } };
                }
                return { id, patch: { nodes: { [id]: null }, ...(parentId ? { replies: { [parentId]: { remove: [id] } } } : { roots: { remove: [id] } }) } };
            }
            if (action.type === 'moderate') {
                const state = parse(v.object({ isMinimized: v.boolean(), minimizedReason: v.nullable(v.string()) }), raw, 'upstream');
                return { id, patch: { nodes: { [id]: state } } };
            }
            if (action.type === 'edit') {
                const state = parse(v.object({ id: NodeID, body: G.Comment.entries.body, bodyHTML: G.Comment.entries.bodyHTML,
                    lastEditedAt: G.Comment.entries.lastEditedAt, url: G.Comment.entries.url, replyTo: G.Comment.entries.replyTo }), raw, 'upstream');
                const { replyTo, ...value } = state;
                return { id, patch: { nodes: { [id]: { ...value, parentId: replyTo?.id ?? null } } } };
            }
            const comment = node(parse(G.Comment, raw, 'upstream'));
            const counts = parse(v.object({ discussion: v.object({ id: NodeID, number: v.number(), comments: v.object({ totalCount: v.number() }) }),
                replyTo: v.nullable(v.object({ id: NodeID, replies: v.object({ totalCount: v.number() }) })) }), raw, 'upstream');
            requireCondition(counts.discussion.id === discussionId && comment.parentId === (parentId || null), 502, 'UPSTREAM_SCHEMA', 'GitHub returned a comment observation in another discussion.');
            return { id, patch: { nodes: { [id]: comment }, roots: { total: counts.discussion.comments.totalCount, ...(!parentId ? { add: [id] } : {}) },
                ...(parentId ? { replies: { [parentId]: { add: [id], total: counts.replyTo!.replies.totalCount } } } : {}) } };
        } catch (error) {
            // Identity confirms the effect even when its optional display fields cannot be adopted.
            return { id };
        }
    }
    async markdown(text: string, token: string): Promise<string> {
        return this.#response('/markdown', token, 'POST', { mode: 'gfm', context: this.repo, text }, true);
    }
    async exchange(parameters: Record<string, string>): Promise<G.OAuthToken> {
        try {
            const response = await githubText('https://github.com/login/oauth/access_token', {
                method: 'POST', headers: { Accept: 'application/json', 'User-Agent': 'giscusflare/5' },
                body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.keys.clientSecret, ...parameters }),
            }, 16384);
            const raw = parseJSON(response, 'upstream');
            if (v.is(v.object({ error: v.string() }), raw))
                throw new AppError(401, 'GITHUB_AUTH', 'GitHub did not authorize this session. Sign in again.');
            return parse(G.OAuthToken, raw, 'upstream');
        }
        catch (error) {
            if (error instanceof AppError)
                throw error;
            throw new AppError(502, 'OAUTH', 'GitHub sign-in failed. Start again.');
        }
    }
    /** Authentication retains immutable identity; Page owns current display. */
    async principal(token:string):Promise<string>{
        return (await this.#rest(G.Viewer,'/user',token)).node_id;
    }

}
