import * as v from 'valibot';
import * as G from '../contracts/github.js';
import { parse, parseJSON, type Schema } from '../contracts/parse.js';
import { InstallationRecord } from '../contracts/storage.js';
import type { Widget, Selection, Selector, ReadIntent, Action } from '../contracts/requests.js';
import type { Comment, Discussion, Reactions, Patch,Permissions,AccessResult,AccountPatch,SelectedReactions,WindowPage,Window } from '../contracts/document.js';
import type { PublicConfig, SecretConfig } from '../contracts/config.js';
import { User, NodeID } from '../contracts/primitives.js';
import { appJWT, sha1 } from './crypto.js';
import {AppError,requireCondition,failure,type Failure} from './errors.js';
import {countObservation,type CountTarget} from '../contracts/count.js';
import {discussionScope} from './authorization.js';
import {Store} from './store.js';
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
const PublicReaction=v.omit(G.ReactionGroup,['viewerHasReacted']);
const PublicComment=v.object({...v.omit(G.Comment,['viewerDidAuthor','viewerCanUpdate','viewerCanDelete','viewerCanMinimize','viewerCanUnminimize']).entries,reactionGroups:v.array(PublicReaction)});
const PUBLIC_REACTIONS=GRAPH.reactions.replace('viewerHasReacted','');
function reactions(groups:v.InferOutput<typeof PublicReaction>[]): Reactions {
    return Object.fromEntries(groups.map(g=>[g.content,{count:g.reactors.totalCount}]));
}
const AUTHORITY='viewerDidAuthor viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize';
const PermissionObservation=v.pick(G.Comment,['id','viewerDidAuthor','viewerCanUpdate','viewerCanDelete','viewerCanMinimize','viewerCanUnminimize']);
function permissions(raw:v.InferOutput<typeof PermissionObservation>):Permissions{return {didAuthor:raw.viewerDidAuthor,canUpdate:raw.viewerCanUpdate,canDelete:raw.viewerCanDelete,canMinimize:raw.viewerCanMinimize,canUnminimize:raw.viewerCanUnminimize};}
function selections(groups:G.Comment['reactionGroups']):SelectedReactions{return Object.fromEntries(groups.map(g=>[g.content,g.viewerHasReacted]));}
function account(raw:v.InferOutput<typeof PermissionObservation>&{reactionGroups?:G.Comment['reactionGroups']}):Omit<AccountPatch,'principal'|'observedAt'>{return {permissions:{[raw.id]:permissions(raw)},...(raw.reactionGroups?{reactions:{[raw.id]:selections(raw.reactionGroups)}}:{})};}
function node(raw:v.InferOutput<typeof PublicComment>):Comment {
  return {id:raw.id,body:raw.body,url:raw.url,parentId:raw.replyTo?.id??null,createdAt:raw.createdAt,lastEditedAt:raw.lastEditedAt,deletedAt:raw.deletedAt,author:raw.author,authorAssociation:raw.authorAssociation,isMinimized:raw.isMinimized,minimizedReason:raw.minimizedReason,reactions:reactions(raw.reactionGroups),upvotes:raw.upvoteCount};
}
function window(connection:Pick<G.Replies,'totalCount'|'pageInfo'>&{nodes:{id:string}[]},count:Window['count'],order:'oldest'|'newest',unobserved=false):Window {
    const p = connection.pageInfo;
    return { ids: connection.nodes.map(n => n.id), count, cursor: unobserved&&connection.totalCount>0?'':order === 'oldest' ? (p.hasNextPage ? p.endCursor : null) : (p.hasPreviousPage ? p.startCursor : null) };
}
type SelectedDiscussion={id?:string;number:number};
export interface CommandTarget {discussion:Discussion;archived:boolean;targetId:string;parentId:string}
function thread(raw:(Omit<G.DiscussionSummary,'reactionGroups'>&{reactionGroups:v.InferOutput<typeof PublicReaction>[]})|null):Discussion|null{return raw?{id:raw.id,number:raw.number,title:raw.title,url:raw.url,locked:raw.locked,closed:raw.closed,answerId:raw.answer?.id??null,reactions:reactions(raw.reactionGroups)}:null;}
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
        throw new AppError(502, 'UPSTREAM','GitHub could not complete the request.');
    }
    catch (error) {
        if (error instanceof AppError)
            throw error;
        throw new AppError(502, 'UPSTREAM','The connection to GitHub ended before a complete response arrived.');
    }
    finally {
        clearTimeout(timer);
    }
}
const apiHeaders = (token: string) => ({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'User-Agent':'giscusflare', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' });
/** Registration is an explicit operator/open-hosting operation, never an operation prerequisite. */
export async function registerRepository(repo:string,category:string,config:Pick<PublicConfig,'appId'>,keys:Pick<SecretConfig,'privateKey'>) {
  const jwt=await appJWT(config.appId,keys.privateKey,Date.now());
  const read=async(path:string,token:string,body?:unknown)=>parseJSON(await githubText('https://api.github.com'+path,{method:body===undefined?'GET':'POST',headers:apiHeaders(token),...(body===undefined?{}:{body:JSON.stringify(body)})}),'upstream');
  const installation=parse(G.Installation,await read('/repos/'+repo+'/installation',jwt),'upstream');
  const issued=parse(G.InstallationToken,await read('/app/installations/'+installation.id+'/access_tokens',jwt,{repositories:[repo.split('/')[1]],permissions:{discussions:'write'}}),'upstream');
  const envelope=parse(G.GraphQLEnvelope,await read('/graphql',issued.token,{query:QUERIES.repository,variables:{owner:repo.split('/')[0],name:repo.split('/')[1]}}),'upstream');
  requireCondition(!envelope.errors?.length,502,'UPSTREAM','GitHub could not register the repository.');
  const {repository}=parse(G.RepositoryResponse,envelope.data,'upstream');
  requireCondition(repository&&!repository.isPrivate&&repository.nameWithOwner.toLowerCase()===repo,403,'PUBLIC_ONLY','Register the canonical name of a public repository with this GitHub App installed.');
  const selected=repository.discussionCategories.nodes.find(c=>c.name===category);
  requireCondition(selected,403,'CATEGORY','The discussion category does not exist.');
  return {repositoryId:repository.id,installationId:installation.id,categoryId:selected.id};
}
export class GitHub {
    #installation: {
        token: string;
        expires:number;installationId:number;
    }|undefined;
    constructor(readonly repo:string,readonly repositoryId:string,readonly installationId:number,readonly categoryId:string,readonly config:PublicConfig,readonly keys:SecretConfig,readonly store:Store) { }
    #names(): {
        owner: string;
        name: string;
    } { const [owner, name] = this.repo.split('/'); return { owner: owner!, name: name! }; }
    #scope(repository:G.RepositoryHead,discussion?:G.DiscussionIdentity|null,selected?:SelectedDiscussion):void{
      requireCondition(!repository.isPrivate&&repository.id===this.repositoryId&&repository.nameWithOwner.toLowerCase()===this.repo,403,'PUBLIC_ONLY','The repository is outside this public page.');
      if(discussion)this.#discussion(discussion,selected);
    }
    #discussion(discussion:G.DiscussionIdentity,selected?:SelectedDiscussion):void{
      discussionScope(discussion,this.repo,this.repositoryId,this.categoryId);
      requireCondition(!selected||discussion.number===selected.number&&(!selected.id||discussion.id===selected.id),403,'PERMISSION','The discussion identity changed.');
    }
    async #response(path: string, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, text = false): Promise<string> {
        try {
            return await githubText('https://api.github.com' + path, { method, headers: { ...apiHeaders(token), ...(text ? { Accept: 'text/html' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        }
        catch (error) {
            if (error instanceof AppError && error.code === 'GITHUB_AUTH' && this.#installation?.token === token) {
                this.#installation = undefined;
                this.store.delete('installation');
                throw new AppError(503,'CONFIGURATION','The GitHub App credential was revoked. Check the installation or retry to renew it.');
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
                if (record&&record.installationId===this.installationId&&record.expires> this.store.now() + 300000) {
                    this.#installation = record;
                    return record.token;
                }
            }
            catch {
                this.store.delete(recordKey);
            }
            beforeRenew?.();
            const jwt=await appJWT(this.config.appId,this.keys.privateKey,this.store.now());
            let result:v.InferOutput<typeof G.InstallationToken>;
            try{result=await this.#rest(G.InstallationToken, `/app/installations/${this.installationId}/access_tokens`, jwt, 'POST', { repositories: [this.#names().name], permissions:{discussions:'write'}});}
            catch(error){if(error instanceof AppError&&error.code==='GITHUB_AUTH')throw new AppError(503,'CONFIGURATION','The GitHub App credentials could not renew repository access.');throw error;}
            const expires = Date.parse(result.expires_at);
            requireCondition(expires > this.store.now(), 502, 'UPSTREAM_SCHEMA', 'GitHub issued an expired installation token.');
            await this.store.putSecret(recordKey, InstallationRecord, {token:result.token,expires,installationId:this.installationId},this.keys.sessionSecret, context, expires);
            this.#installation={token:result.token,expires,installationId:this.installationId};
            return result.token;
        });
    }
    /** One minimal batch obtains exact root or reply counts and their canonical scope. */
    async counts(pages:{target:CountTarget;mapped?:{id:string;number:number}}[],token:string):Promise<{
      meta:G.RepositoryHead;observedAt:number;
      summaries:({discussion:G.DiscussionIdentity;count:number}|null|Failure)[];
    }>{
      const observedAt=this.store.now(),variables:Record<string,string|number|boolean>={...this.#names()};
      const declarations=['$owner:String!','$name:String!'],known:string[]=[],nodes:string[]=[],searches=new Map<string,{alias:string;hash:string}>(),discovery=new Map<number,{alias:string;hash:string}>();
      for(const [i,page]of pages.entries()){
        const {selector,window}=page.target,number=page.mapped?.number??(selector.kind==='discussion'?selector.number:null);
        if(selector.kind==='page'&&!page.mapped){
          let search=searches.get(selector.key);
          if(!search){
            search={alias:'s'+searches.size,hash:await sha1(selector.key)};searches.set(selector.key,search);
            declarations.push('$'+search.alias+':String!');variables[search.alias]=`repo:${this.repo} in:body ${JSON.stringify(search.hash)} sort:created-asc`;
            nodes.push(`${search.alias}:search(type:DISCUSSION,query:$${search.alias},first:10){nodes{... on Discussion{${IDENTITY} body comments(first:1){totalCount}}}}`);
          }
          discovery.set(i,search);
        }
        if(window.kind==='replies'){
          declarations.push('$p'+i+':ID!');variables['p'+i]=window.parentId;
          nodes.push(`p${i}:node(id:$p${i}){... on DiscussionComment{id replyTo{id} discussion{${IDENTITY}} replies(first:1){totalCount}}}`);
        }else if(number!==null){
          declarations.push('$n'+i+':Int!');variables['n'+i]=number;
          known.push(`p${i}:discussion(number:$n${i}){${IDENTITY} comments(first:1){totalCount}}`);
        }
      }
      const query=`query CommentCounts(${declarations.join(',')}){repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived ${known.join(' ')}} ${nodes.join(' ')}}`;
      const envelope=await this.#rest(G.GraphQLEnvelope,'/graphql',token,'POST',{query,variables}),errors=envelope.errors??[];
      if(errors.some(e=>e.type==='RATE_LIMITED'))throw new AppError(429,'RATE_LIMIT','GitHub rate limit reached.',60);
      requireCondition(errors.every(e=>typeof e.path?.[0]==='string'&&(/^[ps]\d+$/.test(e.path[0])||e.path[0]==='repository'&&/^p\d+$/.test(String(e.path[1])))),502,'UPSTREAM','GitHub could not acquire these counts.');
      const data=parse(v.record(v.string(),v.unknown()),envelope.data,'upstream'),meta=parse(G.RepositoryHead,data.repository,'upstream'),repository=data.repository as Record<string,unknown>;
      this.#scope(meta);
      const summaries=pages.map((page,i)=>{try{
        const search=discovery.get(i);
        if(errors.some(e=>e.path?.[0]==='p'+i||e.path?.[0]==='repository'&&e.path[1]==='p'+i||search&&e.path?.[0]===search.alias))throw new AppError(502,'UPSTREAM','GitHub could not acquire this count.');
        const {selector,window}=page.target;let discussion:G.DiscussionIdentity,count:number;
        let searched:v.InferOutput<typeof G.DiscussionCount>|null=null;
        if(search){
          const result=parse(v.object({nodes:v.pipe(v.array(v.nullable(v.object({...G.DiscussionCount.entries,body:v.string()}))),v.maxLength(10))}),data[search.alias],'upstream');
          searched=result.nodes.find(d=>d&&d.category.id===this.categoryId&&d.body.includes('<!-- sha1: '+search.hash+' -->'))??null;
          if(searched)this.#discussion(searched);
        }
        if(window.kind==='replies'){
          const parent=parse(v.nullable(v.object({id:NodeID,replyTo:G.Comment.entries.replyTo,discussion:G.DiscussionIdentity,replies:v.object({totalCount:G.Replies.entries.totalCount})})),data['p'+i],'upstream');
          requireCondition(parent&&parent.id===window.parentId&&!parent.replyTo,410,'NOT_FOUND','The reply parent is unavailable.');
          if(search)requireCondition(searched,410,'NOT_FOUND','The reply discussion is unavailable.');
          discussion=parent.discussion;count=parent.replies.totalCount;
        }else if(page.mapped||selector.kind==='discussion'){
          requireCondition(Object.hasOwn(repository,'p'+i),502,'UPSTREAM_SCHEMA','GitHub omitted a count.');
          if(repository['p'+i]===null)throw new AppError(410,'NOT_FOUND','The mapped discussion is unavailable.');
          const selected=parse(G.DiscussionCount,repository['p'+i],'upstream');discussion=selected;count=selected.comments.totalCount;
        }else{
          if(!searched)return null;discussion=searched;count=searched.comments.totalCount;
        }
        const expected=page.mapped??(selector.kind==='discussion'?selector:searched??undefined);
        if(window.kind==='replies'||!search)this.#discussion(discussion,expected);
        return {discussion:parse(G.DiscussionIdentity,discussion,'upstream'),count};
      }catch(error){return failure(error);}});
      return {meta,summaries,observedAt};
    }
    /** One physical query acquires the selected document window and its scope. */
    async page(selected:SelectedDiscussion,request:{read:ReadIntent;selector:Selector;ttl:number;profiles:string[];html:boolean},token:string):Promise<WindowPage>{
        const intent=request.read,number=selected.number;
        const order=intent.kind==='roots'?intent.order:'oldest',cursor='cursor'in intent?intent.cursor:'',parentId=intent.kind==='replies'?intent.parentId:undefined,
          ids='ids'in intent?intent.ids:undefined,replyPrefetch='replyPrefetch'in intent?intent.replyPrefetch:0,root=intent.kind==='roots';
        const fields = COMMENT.replace(AUTHORITY,'').replace(GRAPH.reactions,PUBLIC_REACTIONS).replace('bodyHTML', 'bodyHTML @include(if:$html)');
        const comment = `${fields} discussion{${IDENTITY}} replies(last:$prefetch){${GRAPH.page} nodes @include(if:$previewReplies){${fields}}}`;
        const summary = `id number title url locked closed answer{id} ${GRAPH.scope} ${PUBLIC_REACTIONS}`;
        const query = `query Page($owner:String!,$name:String!,$number:Int!,$first:Int,$last:Int,$after:String,$before:String,$prefetch:Int!,$previewReplies:Boolean!,$roots:Boolean!,$ids:[ID!]!,$selected:Boolean!,$parent:ID!,$reply:Boolean!,$replyBefore:String,$html:Boolean!){
      repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussion(number:$number){${summary} comments(first:$first,last:$last,after:$after,before:$before){${GRAPH.page} nodes @include(if:$roots){${comment}}}}}
      nodes(ids:$ids) @include(if:$selected){... on DiscussionComment{${comment}}}
      parent:node(id:$parent) @include(if:$reply){... on DiscussionComment{${fields} discussion{${IDENTITY}} replies(last:50,before:$replyBefore){${GRAPH.page} nodes{${fields}}}}}
    }`;
        const publicReplies=v.object({...G.Replies.entries,nodes:v.pipe(v.array(PublicComment),v.maxLength(100))});
        const preview=v.object({...publicReplies.entries,nodes:replyPrefetch>0?publicReplies.entries.nodes:v.optional(publicReplies.entries.nodes,[])});
        const observed=v.object({...PublicComment.entries,discussion:G.DiscussionIdentity,replies:preview});
        const roots=v.pipe(v.array(observed),v.maxLength(20)),selectedNodes=v.array(v.nullable(observed));
        const connection=v.object({...G.Replies.entries,nodes:root?roots:v.optional(roots,[])});
        const schema=v.object({repository:v.nullable(v.object({...G.RepositoryHead.entries,discussion:v.nullable(v.object({...G.DiscussionSummary.entries,reactionGroups:v.array(PublicReaction),comments:connection}))})),nodes:ids!==undefined?selectedNodes:v.optional(selectedNodes),parent:parentId?v.nullable(v.object({...observed.entries,replies:publicReplies})):v.optional(v.nullable(v.object({...observed.entries,replies:publicReplies})))});
        const observedAt=this.store.now();
        const data=await this.graph(schema,query,{...this.#names(),number,roots: root, first: root && order === 'oldest' ? 20 : root ? null : 1, last: root && order === 'newest' ? 20 : null, after: root && order === 'oldest' && cursor ? cursor : null, before: root && order === 'newest' && cursor ? cursor : null, replyBefore: parentId && cursor ? cursor : null, prefetch: Math.max(1,replyPrefetch), previewReplies:replyPrefetch>0, ids: ids ?? [], selected: ids !== undefined, parent: parentId ?? 'unused', reply:Boolean(parentId),html:request.html},token, ids !== undefined);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        const { discussion: raw, ...repository } = data.repository;
        this.#scope(repository,raw,selected);
        const count=(total:number,parent?:string)=>raw?countObservation({selector:request.selector,window:parent?{kind:'replies',parentId:parent}:{kind:'roots'}},total,{id:raw.id,number:raw.number},observedAt,request.ttl):null;
        const contentHints:Record<string,{markdown:string;html:string}>={},nodes:Record<string,Comment>={},replies:Record<string,Window>={};
        const accept=(item:v.InferOutput<typeof observed>)=>{
            requireCondition(raw,403,'PERMISSION','The requested comment is outside this page.');
            this.#discussion(item.discussion,raw);
            nodes[item.id]=node(item);if(item.bodyHTML)contentHints[item.id]={markdown:item.body,html:item.bodyHTML};
            if (!item.replyTo) {
                replies[item.id] = window(item.replies,count(item.replies.totalCount,item.id),'newest',!parentId&&replyPrefetch===0);
                for (const reply of item.replies.nodes) {
                    requireCondition(reply.replyTo?.id === item.id, 502, 'UPSTREAM_SCHEMA', 'GitHub returned replies for another comment.');
                    if(reply.bodyHTML)contentHints[reply.id]={markdown:reply.body,html:reply.bodyHTML};
                    nodes[reply.id]=node(reply);
                }
            }
        };
        let acquired:Window={ids:[],count:count(raw?.comments.totalCount??0),cursor:null};
        if (root && raw) {
            for (const item of raw.comments.nodes)
                accept(item);
            acquired = window(raw.comments,count(raw.comments.totalCount),order);
        }
        if (ids) {
            requireCondition(data.nodes?.length === ids.length, 502, 'UPSTREAM_SCHEMA', 'GitHub omitted a requested comment.');
            for (const [i, item] of data.nodes!.entries())
                if (item) {
                    requireCondition(item.id === ids[i], 502, 'UPSTREAM_SCHEMA', 'GitHub returned another comment.');
                    accept(item);
                    if (!acquired.ids.includes(item.id))
                        acquired.ids.push(item.id);
                }
        }
        if (parentId) {
            const parent = data.parent;
            requireCondition(parent && parent.id === parentId && !parent.replyTo, 404, 'NOT_FOUND', 'Reply thread not found.');
            accept(parent);
            acquired = window(parent.replies,count(parent.replies.totalCount,parent.id),'newest');
        }
        if(intent.kind==='selected')for(const id of acquired.ids)requireCondition(!nodes[id]!.parentId,400,'BAD_INPUT','Ranked windows contain root comments.');
        return {observedAt,nodes,window:acquired,replies,contentHints,metadata:{thread:thread(raw),archived:repository.isArchived,unavailable:!raw,profiles:request.profiles}};
    }
    async create(widget: Selection & Partial<Pick<Widget,'description'>>,token:string): Promise<G.DiscussionAccess> {
        const page=new URL(widget.pageURL);
        page.hash = '';
        page.searchParams.delete('giscus');
        const body = `# ${widget.selector.kind==='page'?widget.selector.key:''}\n\n${widget.description || ''}\n\n${page.toString()}\n\n<!-- sha1: ${await sha1(widget.selector.kind==='page'?widget.selector.key:'')} -->`;
        const data = await this.graph(G.CreateResponse, `mutation CreateDiscussion($input:CreateDiscussionInput!) { createDiscussion(input:$input) { discussion { ${ACCESS} } } }`, { input: {repositoryId:this.repositoryId,categoryId:this.categoryId,title:widget.selector.kind==='page'?widget.selector.key:'', body } }, token);
        const created=data.createDiscussion.discussion;this.#discussion(created);return created;
    }
    /** Scope and permission preflight does not acquire the target's Markdown or rich content. */
    async targetAccess(selected:SelectedDiscussion,action:Action,token:string):Promise<CommandTarget> {
        const targetId = action.type === 'comment' ? action.replyToId
            : action.type === 'reaction' ? action.subject.kind === 'comment' ? action.subject.id : '' : action.id;
        const summary = `id number title url locked closed answer{id} ${GRAPH.scope} ${GRAPH.reactions}`;
        const permission=action.type==='edit'?'viewerCanUpdate':action.type==='delete'?'viewerCanDelete':action.type==='moderate'?action.minimized?'viewerCanMinimize':'viewerCanUnminimize':null;
        const targetSchema=v.object({id:NodeID,replyTo:G.Comment.entries.replyTo,discussion:G.DiscussionIdentity,...v.partial(v.pick(G.Comment,['viewerCanUpdate','viewerCanDelete','viewerCanMinimize','viewerCanUnminimize'])).entries});
        const data = await this.graph(v.object({ repository: v.nullable(v.object({ ...G.RepositoryHead.entries, discussion: v.nullable(G.DiscussionSummary) })),
            target: v.optional(v.nullable(targetSchema)) }),
            `query OperationAccess($owner:String!,$name:String!,$number:Int!,$target:ID!,$selected:Boolean!){repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussion(number:$number){${summary}}} target:node(id:$target) @include(if:$selected){... on DiscussionComment{id replyTo{id} ${permission??''} discussion{${IDENTITY}}}}}`,
            { ...this.#names(), number:selected.number, target: targetId || 'unused', selected: Boolean(targetId) }, token);
        requireCondition(data.repository, 404, 'NOT_FOUND', 'The repository is not accessible.');
        const { discussion: raw, ...repository } = data.repository;
        this.#scope(repository,raw,selected);
        requireCondition(!repository.isArchived,403,'ARCHIVED','The repository is archived.');
        requireCondition(raw,404,'NOT_FOUND','Discussion not found.');
        const target=data.target;
        if(targetId){requireCondition(target&&target.id===targetId,404,'NOT_FOUND','Comment not found.');this.#discussion(target.discussion,raw);}
        if(action.type==='comment'||action.type==='reaction')requireCondition(!raw.locked,403,'LOCKED','This discussion is locked.');
        if(permission)requireCondition(parse(v.boolean(),target?.[permission],'upstream'),403,'PERMISSION','You cannot change this comment.');
        const parentId=action.type==='comment'&&target?target.replyTo?.id||target.id:target?.replyTo?.id||'';
        return {discussion:thread(raw)!,archived:repository.isArchived,targetId:targetId||raw.id,parentId};
    }
    /** Account authority and selections contain no comment interpretation or body acquisition. */
    async access(selected:SelectedDiscussion,ids:string[],token:string):Promise<AccessResult> {
      const flags=AUTHORITY;
      const observations=v.object({id:NodeID,replyTo:G.Comment.entries.replyTo,discussion:G.DiscussionIdentity,
        viewerDidAuthor:v.boolean(),viewerCanUpdate:v.boolean(),viewerCanDelete:v.boolean(),viewerCanMinimize:v.boolean(),viewerCanUnminimize:v.boolean(),reactionGroups:G.Reactions});
      const schema=v.object({viewer:Viewer,repository:v.nullable(v.object({...G.RepositoryHead.entries,discussion:v.nullable(G.DiscussionSummary)})),nodes:v.array(v.nullable(observations))});
      const observedAt=this.store.now();
      const data=await this.graph(schema,`query ViewerAccess($owner:String!,$name:String!,$number:Int!,$ids:[ID!]!){viewer{id login avatarUrl url} repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussion(number:$number){id number title url locked closed answer{id} ${GRAPH.scope} ${GRAPH.reactions}}} nodes(ids:$ids){... on DiscussionComment{id replyTo{id} discussion{${IDENTITY}} ${flags} ${GRAPH.reactions}}}}`,{...this.#names(),number:selected.number,ids},token,true);
      requireCondition(data.repository,404,'NOT_FOUND','The repository is not accessible.');
      const {discussion:raw,...repository}=data.repository;
      this.#scope(repository,raw,selected);
      const permissions:Record<string,Permissions>={},chosen:Record<string,Record<string,boolean>>={};
      requireCondition(data.nodes.length===ids.length,502,'UPSTREAM_SCHEMA','GitHub omitted account observations.');
      for(const [i,item] of data.nodes.entries()){
        if(!item){permissions[ids[i]!]={didAuthor:false,canUpdate:false,canDelete:false,canMinimize:false,canUnminimize:false};chosen[ids[i]!]={};continue;}
        requireCondition(item.id===ids[i]&&raw,403,'PERMISSION','This account observation is outside the page.');
        this.#discussion(item.discussion,raw);
        permissions[item.id]=account(item).permissions![item.id]!;chosen[item.id]=selections(item.reactionGroups);
      }
      return {observedAt,principal:data.viewer,permissions,reactions:chosen,threadReactions:Object.fromEntries((raw?.reactionGroups??[]).map(g=>[g.content,g.viewerHasReacted])),
        thread:thread(raw),
        archived:repository.isArchived,unavailable:!raw};
    }
    /** Mutation selection returns only confirmed fields owned by this operation. */
    async contribute(action: Action, discussionId: string, targetId: string, parentId: string, token: string, html = false): Promise<{id:string;patch?:Patch;account?:Omit<AccountPatch,'principal'|'observedAt'>;rootCount?:number;replyCount?:number}> {
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
                input={id:targetId};fields=`id body deletedAt author{login avatarUrl url} ${AUTHORITY} discussion{id number comments(first:1){totalCount}} replyTo{id replies(first:1){totalCount}}`;
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
                fields=`... on DiscussionComment{id isMinimized minimizedReason ${AUTHORITY}}`;
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
                const group=selected?parse(G.ReactionGroup,selected,'upstream'):null,count=group?.reactors.totalCount??0,selectedState=group?.viewerHasReacted??false;
                return {id,patch:{reactions:{[id]:{[action.reaction]:{count}}}},account:action.subject.kind==='discussion'?{threadReactions:{[action.reaction]:selectedState}}:{reactions:{[id]:{[action.reaction]:selectedState}}}};
            }
            if (action.type === 'delete') {
                if (data.effect.identity) requireCondition(raw, 502, 'UPSTREAM_SCHEMA', 'GitHub did not observe the retained comment.');
                if (raw) {
                    const tombstone = parse(v.object({ body:G.Comment.entries.body,deletedAt: G.Comment.entries.deletedAt, author: G.Comment.entries.author,
                        viewerCanUpdate: v.boolean(), viewerCanDelete: v.boolean(), viewerCanMinimize: v.boolean(), viewerCanUnminimize: v.boolean() }), raw, 'upstream');
                    const {viewerCanUpdate,viewerCanDelete,viewerCanMinimize,viewerCanUnminimize,...publicTombstone}=tombstone;
                    const authority=parse(PermissionObservation,raw,'upstream'),totals=parse(v.object({discussion:v.object({id:NodeID,comments:v.object({totalCount:G.Replies.entries.totalCount})}),replyTo:v.nullable(v.object({id:NodeID,replies:v.object({totalCount:G.Replies.entries.totalCount})}))}),raw,'upstream');
                    requireCondition(totals.discussion.id===discussionId,502,'UPSTREAM_SCHEMA','The deletion observation belongs to another discussion.');
                    return {id,rootCount:totals.discussion.comments.totalCount,...(parentId&&totals.replyTo?{replyCount:totals.replyTo.replies.totalCount}:{}),patch:{nodes:{[id]:publicTombstone}},account:account(authority)};
                }
                return { id, patch: { nodes: { [id]: null }, ...(parentId ? { replies: { [parentId]: { remove: [id] } } } : { roots: { remove: [id] } }) } };
            }
            if (action.type === 'moderate') {
                const state = parse(v.object({ isMinimized: v.boolean(), minimizedReason: v.nullable(v.string()) }), raw, 'upstream');
                return {id,patch:{nodes:{[id]:state}},account:account(parse(PermissionObservation,raw,'upstream'))};
            }
            if (action.type === 'edit') {
                const state = parse(v.object({ id: NodeID, body: G.Comment.entries.body, bodyHTML: G.Comment.entries.bodyHTML,
                    lastEditedAt: G.Comment.entries.lastEditedAt, url: G.Comment.entries.url, replyTo: G.Comment.entries.replyTo }), raw, 'upstream');
                const {replyTo,bodyHTML,...value}=state;
                return {id,patch:{nodes:{[id]:{...value,parentId:replyTo?.id??null}},...(bodyHTML?{contentHints:{[id]:{markdown:value.body,html:bodyHTML}}}:{})}};
            }
            const source=parse(G.Comment,raw,'upstream'),comment=node(source);
            const counts = parse(v.object({ discussion: v.object({ id: NodeID, number: v.number(), comments: v.object({ totalCount: v.number() }) }),
                replyTo: v.nullable(v.object({ id: NodeID, replies: v.object({ totalCount: v.number() }) })) }), raw, 'upstream');
            requireCondition(counts.discussion.id === discussionId && comment.parentId === (parentId || null), 502, 'UPSTREAM_SCHEMA', 'GitHub returned a comment observation in another discussion.');
            return {id,account:account(source),rootCount:counts.discussion.comments.totalCount,...(parentId?{replyCount:counts.replyTo!.replies.totalCount}:{}),patch:{...(typeof raw!.bodyHTML==='string'?{contentHints:{[id]:{markdown:comment.body,html:raw!.bodyHTML}}}:{}),nodes:{[id]:comment},roots:{...(!parentId?{add:[id]}:{})},...(parentId?{replies:{[parentId]:{add:[id]}}}:{})}};
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
                method: 'POST', headers: { Accept: 'application/json', 'User-Agent':'giscusflare' },
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
    async viewer(token:string){return (await this.graph(v.object({viewer:Viewer}),'query ViewerIdentity{viewer{id login avatarUrl url}}',{},token)).viewer;}
    async principal(token:string):Promise<string>{
        return (await this.#rest(G.Viewer,'/user',token)).node_id;
    }

}
