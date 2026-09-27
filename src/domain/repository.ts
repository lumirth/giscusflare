import * as v from 'valibot';
import {RankingEngine} from '../ranking/engine.js';
import {discoveryQuery,observationQuery,parseDiscovery,parseObservation} from '../ranking/github.js';
import type {Source,Storage as RankingStorage,Candidate} from '../ranking/types.js';
import type { MutationResult, ThreadView } from '../contracts/results.js';
import { configuration, secrets, type ConfigBindings, type RepositoryPolicy } from '../contracts/config.js';
import { parse, type Schema } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import * as G from '../contracts/github.js';
import { RepositoryName } from '../contracts/primitives.js';
import { authorizeWidget, discussionScope, parentOrigin, policy, repositoryScope } from './authorization.js';
import { Auth } from './auth.js';
import { hash } from './crypto.js';
import { GitHub } from './github.js';
import { AppError, requireCondition } from './errors.js';
import { Store } from './store.js';
import type { FetchLike } from './platform.js';
interface Context { widget: R.Widget; client: GitHub; auth: Auth; appToken: string; token: string; session: S.Session | null; meta: G.Repository; categoryId: string; policy: RepositoryPolicy }
export class RepositoryEngine {
  #ranking?:RankingEngine;
  #repositoryId: string | null | undefined;
  #identity: v.InferOutput<typeof S.ActorIdentity> | null | undefined;
  constructor(readonly env:ConfigBindings,readonly store:Store,readonly transport?:FetchLike,readonly rankingStorage?:RankingStorage){}
  #ranker(repo:string):RankingEngine|undefined{
    if(this.#ranking)return this.#ranking;
    const config=configuration(this.env),selected=config.repositories[repo]?.ranking;
    if(!selected)return;
    requireCondition(this.rankingStorage,503,'CONFIGURATION','Ranking storage is unavailable.');
    const count=Object.values(config.repositories).filter(p=>p.ranking).length,b=config.rankingBudget;
    const options={...selected,maxRequestsPerHour:Math.floor(b.maxRequestsPerHour/count),maxRowsWrittenPerDay:Math.floor(b.maxRowsWrittenPerDay/count),maxRowsReadPerDay:Math.floor(b.maxRowsReadPerDay/count),maxOrderBytes:b.maxOrderBytes};
    requireCondition(options.maxRowsWrittenPerDay>=256&&options.maxRowsReadPerDay>=256&&options.maxRequestsPerHour>=1,503,'CONFIGURATION','The ranking allowance is too small for the configured repositories.');
    return this.#ranking=new RankingEngine(this.rankingStorage,options,this.store.now);
  }
  #rankingSource(repo:string,discussionId:string):Source{
    const base=this.#base(repo);
    const read=async(spec:{query:string;variables:Record<string,unknown>})=>{
      const [owner,name]=repo.split('/');
      const query=spec.query.replace('query(', 'query($owner:String!,$name:String!,').replace(/}$/, ' repository(owner:$owner,name:$name){id nameWithOwner isPrivate isArchived discussionCategories(first:100){nodes{id name isAnswerable}}}}');
      const payload=await base.client.rankingGraph(query,{...spec.variables,owner,name},await base.client.installation()) as {data?:{repository?:unknown};errors?:unknown[]};
      const meta=parse(G.Repository,payload.data?.repository,'upstream');
      const categoryId=repositoryScope(meta,repo,base.policy);
      this.#pinRepository(meta);
      return {payload,scope:{discussionId,repositoryId:meta.id,categoryId}};
    };
    return {
      discover:async(cursor,inputs)=>{const result=await read(discoveryQuery({discussionId,repositoryId:''},cursor,inputs));return parseDiscovery(result.payload,result.scope,inputs);},
      observe:async(ids,inputs)=>{const result=await read(observationQuery(ids,inputs));return parseObservation(result.payload,ids,result.scope,inputs);},
    };
  }
  async ranking(raw:C.RankingCall){
    const input=parse(C.RankingCall,raw),widget=input.request.config;
    const c=await this.#context(widget,input.session),ranker=this.#ranker(widget.repo);
    requireCondition(ranker&&Object.hasOwn(ranker.options.profiles,input.request.profile),400,'BAD_INPUT','This ranking profile is not enabled.');
    const discussion=await this.#access(c);
    requireCondition(discussion,404,'NOT_FOUND','Discussion not found.');
    return ranker.request(discussion.id,input.request.profile,this.#rankingSource(widget.repo,discussion.id));
  }
  async hydrate(raw:C.HydrateCall){
    const input=parse(C.HydrateCall,raw),c=await this.#context(input.request.config,input.session),number=await this.#find(c);
    requireCondition(number,404,'NOT_FOUND','Discussion not found.');
    const nodes=await c.client.hydrate(input.request.ids,c.token,Math.min(input.request.replyPrefetch,c.policy.maxReplyPrefetch));
    const comments:G.RootComment[]=[];
    for(const [index,node] of nodes.entries()){
      if(!node)continue;
      discussionScope(node.discussion,c.widget.repo,c.meta.id,c.categoryId);
      requireCondition(node.id===input.request.ids[index]&&!node.replyTo&&node.discussion.number===number,403,'PERMISSION','The requested comment is outside this page.');
      if(!node.isMinimized)comments.push(parse(G.RootComment,node,'upstream'));
    }
    return {comments,consumed:input.request.ids.length};
  }
  async continueRanking():Promise<void>{
    const identity=this.store.get('identity',S.ActorIdentity);if(!identity)return;
    const ranking=this.#ranker(identity.repo);if(ranking)await ranking.continueJobs(id=>this.#rankingSource(identity.repo,id));
  }
  rankingAlarm():number|null{return this.#ranking?.nextAlarmAt()??null;}

  #base(rawRepo: string): { repo: string; policy: RepositoryPolicy; client: GitHub; auth: Auth } {
    const repo = parse(RepositoryName, rawRepo), config = configuration(this.env), p = policy(config, repo), keys = secrets(this.env);
    const identity = this.#identity === undefined ? (this.#identity = this.store.get('identity', S.ActorIdentity)) : this.#identity;
    requireCondition(!identity || identity.appId === config.appId, 403, 'PERMISSION', 'This repository object belongs to another app or repository.');
    if (!identity) {
      const created = { version: 2 as const, repo, appId: config.appId };
      this.store.put('identity', S.ActorIdentity, created); this.#identity = created;
    }
    const client = new GitHub(repo, config, keys, this.store, this.transport);
    return { repo, policy: p, client, auth: new Auth(config, keys, repo, p, this.store, client) };
  }
  #pinRepository(meta: G.Repository): void {
    if (this.#repositoryId === undefined) this.#repositoryId = this.store.get('repository-id', G.Repository.entries.id);
    requireCondition(this.#repositoryId === null || this.#repositoryId === meta.id, 403, 'PERMISSION', 'This repository name now belongs to a different GitHub repository.');
    if (this.#repositoryId === null) {
      this.store.put('repository-id', G.Repository.entries.id, meta.id); this.#repositoryId = meta.id;
    }
    const repo = parse(RepositoryName, meta.nameWithOwner.toLowerCase());
    if (this.#identity && this.#identity.repo !== repo) {
      const identity = { ...this.#identity, repo };
      this.store.put('identity', S.ActorIdentity, identity); this.#identity = identity;
    }
  }
  async #context(widget: R.Widget, capability: string, write = false): Promise<Context> {
    const base = this.#base(widget.repo); authorizeWidget(configuration(this.env), widget);
    const session = await base.auth.session(capability, widget.origin, write);
    const appToken = await base.client.installation(), meta = await base.client.repository(appToken);
    const categoryId = repositoryScope(meta, widget.repo, base.policy, widget);
    this.#pinRepository(meta);
    this.store.put('scope-hint', G.Repository, meta);
    if (write) requireCondition(!meta.isArchived, 403, 'ARCHIVED', 'The repository is archived.');
    return { widget, client: base.client, auth: base.auth, appToken, token: session?.accessToken || appToken, session, meta, categoryId, policy: base.policy };
  }
  async #mapping(c: Context): Promise<string> { return 'mapping:' + await hash(JSON.stringify([c.meta.id, c.categoryId, c.widget.strict, c.widget.term])); }
  async #find(c: Context): Promise<number | null> {
    if (c.widget.number) return c.widget.number;
    const key = await this.#mapping(c), cached = this.store.get(key, S.Mapping);
    if (cached) return cached.number;
    const matches = await c.client.find(c.widget, c.policy.category, c.appToken);
    for (const match of matches) {
      discussionScope(match, c.widget.repo, c.meta.id, c.categoryId);
      this.store.put(key, S.Mapping, { version: 2, number: match.number }); this.store.delete('creating:' + key);
      return match.number;
    }
    return null;
  }
  async #load(c: Context, order: 'oldest' | 'newest' = 'oldest', cursor = '', includeComments=false, replyPrefetch=5): Promise<G.Discussion | null> {
    const number = await this.#find(c); if (!number) return null;
    const discussion = await c.client.thread(number, order, cursor, c.token, includeComments, Math.min(replyPrefetch,c.policy.maxReplyPrefetch));
    if (discussion) discussionScope(discussion, c.widget.repo, c.meta.id, c.categoryId);
    // A previously mapped thread remains mapped when missing; never silently recreate it.
    return discussion;
  }
  async #access(c: Context): Promise<G.DiscussionAccess | null> {
    const number = await this.#find(c); if (!number) return null;
    const discussion = await c.client.access(number, c.token);
    if (discussion) discussionScope(discussion, c.widget.repo, c.meta.id, c.categoryId);
    return discussion;
  }
  async #ensure(c: Context): Promise<G.DiscussionAccess> {
    const key = await this.#mapping(c);
    return this.store.lock(key, async () => {
      const old = await this.#access(c); if (old) return old;
      requireCondition(!this.store.get('deleted:'+key,S.Tombstone)&&!this.store.get(key,S.Mapping),410,'NOT_FOUND','The mapped discussion was deleted or is no longer available. Select a new discussion explicitly.');
      requireCondition(!c.widget.number, 404, 'NOT_FOUND', 'That discussion number does not exist.');
      requireCondition(!this.store.get('creating:' + key, S.Creation), 409, 'WRITE_UNCERTAIN', 'GitHub may have created this discussion. Check the repository before creating another.');
      requireCondition(c.session, 401, 'AUTH_REQUIRED', 'Sign in to create a discussion.');
      this.store.limit('create:' + c.session.user.login, 10, 3600000);
      this.store.put('creating:' + key, S.Creation, { version: 2, started: this.store.now() });
      try {
        const created = await c.client.create(c.widget, c.meta.id, c.categoryId, c.appToken);
        this.store.put(key, S.Mapping, { version: 2, number: created.number }); this.store.delete('creating:' + key);
        const discussion = await c.client.access(created.number, c.token);
        requireCondition(discussion, 502, 'UPSTREAM', 'The discussion was created but could not be loaded. Refresh before posting.');
        discussionScope(discussion, c.widget.repo, c.meta.id, c.categoryId); return discussion;
      } catch (error) {
        if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) this.store.delete('creating:' + key);
        throw error;
      }
    });
  }
  async #target(c: Context, discussion: G.DiscussionIdentity, id: string): Promise<G.Target> {
    if (id === discussion.id) return { __typename: 'Discussion', ...discussion };
    const target = await c.client.target(id, c.token);
    const parent = target.__typename === 'Discussion' ? target : target.discussion;
    discussionScope(parent, c.widget.repo, c.meta.id, c.categoryId);
    requireCondition(parent.id === discussion.id, 403, 'PERMISSION', 'This comment does not belong to this page.');
    return target;
  }
  async info(raw: R.InfoRequest) {
    const input = parse(R.InfoRequest, raw), base = this.#base(input.repo); parentOrigin(base.policy, input.origin);
    const token = await base.client.installation(), meta = await base.client.repository(token);
    const categoryId = repositoryScope(meta, input.repo, base.policy);
    this.#pinRepository(meta);
    return { repo: meta.nameWithOwner, repoId: meta.id, category: base.policy.category, categoryId, defaultCommentOrder: base.policy.defaultCommentOrder,profiles:Object.keys(base.policy.ranking?.profiles??{}) };
  }
  async counts(raw: R.CountsRequest): Promise<{counts: Record<string, number>}> {
    const input = parse(R.CountsRequest, raw), base = this.#base(input.repo);
    parentOrigin(base.policy, input.origin);
    // Serialize overlapping batches so simultaneous page visits share their reads.
    return this.store.lock('counts', async () => {
      const terms = [...new Set(input.terms)], counts: Record<string, number> = Object.create(null);
      const token = await base.client.installation(), meta = await base.client.repository(token);
      const categoryId = repositoryScope(meta, input.repo, base.policy);
      this.#pinRepository(meta);
      const pages = await Promise.all(terms.map(async term => {
        const mapping = 'mapping:' + await hash(JSON.stringify([meta.id, categoryId, input.strict, term]));
        return {term, mapping, number: this.store.get(mapping, S.Mapping)?.number ?? null};
      }));
      const summaries = await base.client.counts(pages, input.strict, base.policy.category, token);
      for (const [i, p] of pages.entries()) {
        const summary = summaries[i];
        if (summary) {
          discussionScope(summary, input.repo, meta.id, categoryId);
          if (p.number !== summary.number) this.store.put(p.mapping, S.Mapping, {version:2,number:summary.number});
        }
        const count = summary?.comments.totalCount ?? 0;
        counts[p.term] = count;

      }
      return {counts: Object.fromEntries(Object.entries(counts))};
    });
  }
  async thread(raw: C.ThreadCall): Promise<ThreadView> {
    const input=parse(C.ThreadCall,raw),request=input.request,widget=request.config;
    let c:Context,discussion:G.Discussion|null;
    const base=this.#base(widget.repo);authorizeWidget(configuration(this.env),widget);
    // The hint locates a mapping; only the fresh installation-token query grants access.
    const hint=!input.session?this.store.get('scope-hint',G.Repository):null;
    let number=widget.number;
    if(!number&&hint){
      const category=hint.discussionCategories.nodes.find(x=>x.name===base.policy.category)?.id;
      if(category)number=this.store.get('mapping:'+await hash(JSON.stringify([hint.id,category,widget.strict,widget.term])),S.Mapping)?.number??0;
    }
    if(!input.session&&number){
      const token=await base.client.installation();
      const combined=await base.client.combinedThread(number,request.order,request.cursor,token,Math.min(request.replyPrefetch,base.policy.maxReplyPrefetch),request.includeComments);
      const categoryId=repositoryScope(combined,widget.repo,base.policy,widget);
      this.#pinRepository(combined);
      this.store.put('scope-hint',G.Repository,combined);
      c={widget,client:base.client,auth:base.auth,appToken:token,token,session:null,meta:combined,categoryId,policy:base.policy};
      discussion=combined.discussion;
      if(discussion)discussionScope(discussion,widget.repo,combined.id,categoryId);
    }else{
      c=await this.#context(widget,input.session);
      discussion=await this.#load(c,request.order,request.cursor,request.includeComments,request.replyPrefetch);
    }
    const page=discussion?.comments.pageInfo;
    return {profiles:Object.keys(c.policy.ranking?.profiles??{}),discussion,unavailable:!discussion&&Boolean(number||this.store.get(await this.#mapping(c),S.Mapping)||this.store.get('deleted:'+await this.#mapping(c),S.Tombstone)),viewer:c.session?.user||null,archived:c.meta.isArchived,order:request.order,
      nextCursor:request.order==='oldest'?(page?.hasNextPage?page.endCursor:null):(page?.hasPreviousPage?page.startCursor:null)};
  }
  async replies(raw: C.RepliesCall): Promise<G.Replies> {
    const input=parse(C.RepliesCall,raw),c=await this.#context(input.request.config,input.session),number=await this.#find(c);
    requireCondition(number,404,'NOT_FOUND','Discussion not found.');
    const node=await c.client.replies(input.request.parentId,input.request.cursor,c.token);
    requireCondition(node&&node.id===input.request.parentId&&node.discussion.number===number,403,'PERMISSION','These replies belong to another comment or discussion.');
    requireCondition(!node.replyTo,400,'BAD_INPUT','Use the top-level comment ID to load replies.');
    discussionScope(node.discussion,c.widget.repo,c.meta.id,c.categoryId);return node.replies;
  }
  async preview(raw: C.PreviewCall): Promise<{ html: string }> {
    const input = parse(C.PreviewCall, raw), c = await this.#context(input.request.config, input.session, true);
    this.store.limit('preview:' + c.session!.user.login, 30, 60000);
    return { html: await c.client.markdown(input.request.body, c.token) };
  }
  async #write(c: Context, key: string, payload: unknown, create: boolean, action: (discussion: G.DiscussionAccess) => Promise<Omit<MutationResult,'number'>&{rankingReplyTo?:string|null}>): Promise<MutationResult> {
    requireCondition(c.session, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
    const receiptKey = 'receipt:' + await hash(c.session.user.login + ':' + key), fingerprint = await hash(JSON.stringify(payload));
    return this.store.lock(receiptKey, async () => {
      const receipt = this.store.get(receiptKey, S.Receipt);
      if (receipt) {
        requireCondition(receipt.fingerprint === fingerprint, 409, 'CONFLICT', 'This request ID was already used for different content.');
        requireCondition(receipt.state === 'done' && receipt.result, 409, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
        return receipt.result;
      }
      const created = Number(key.split(".")[0]);
      requireCondition(Number.isSafeInteger(created) && created <= this.store.now()+300000 && this.store.now()-created < 86400000, 409, "OPERATION_EXPIRED", "This submission is too old to retry. Check the discussion before submitting again.");
      const discussion = create ? await this.#ensure(c) : await this.#access(c);
      requireCondition(discussion, 404, 'NOT_FOUND', 'Discussion not found.');
      this.store.limit('write:' + c.session!.user.login, 30, 60000); this.store.limit('all-writes', 180, 60000);
      this.store.put(receiptKey, S.Receipt, { version: 2, fingerprint, state: 'pending', result: null });
      try {
        const {rankingReplyTo,...result}=await action(discussion);
        const answer = { ...result, number: discussion.number };
        // GitHub's confirmed result remains successful if derived ranking repair
        // needs to wait for its own allowance or a later observation.
        let ranking:RankingEngine|undefined;
        try{ranking=this.#ranker(c.widget.repo);
        if(ranking){
          const action=Array.isArray(payload)?payload[0]:'';
          const countsReplies=Object.values(ranking.options.profiles).some(p=>(p.weights.replies??0)!==0);
          if(rankingReplyTo){if(action==='delete'&&countsReplies)ranking.invalidate(discussion.id);}
          else if(result.removed)ranking.observeMutation(discussion.id,{id:result.id,deleted:true});
          else if(result.reactions){
            const values:Candidate['values']={};for(const g of result.reactions.reactionGroups)values[g.content]=g.users.totalCount;
            if(result.id!==discussion.id)ranking.observePartial(discussion.id,result.id,values);
          }else if(result.comment){
            const item=result.comment;
            if(item.replyTo){if(action==='comment'&&countsReplies)ranking.invalidate(discussion.id);}
            else if(action==='comment')ranking.invalidate(discussion.id);
            else if(action!=='edit')ranking.observePartial(discussion.id,item.id,{answer:item.isAnswer?1:0},!item.isMinimized);
          }
        }}catch{try{ranking?.invalidate(discussion.id);}catch{console.error('Ranking repair could not be recorded.');}}

        this.store.put(receiptKey, S.Receipt, { version: 2, fingerprint, state: 'done', result: answer }, Math.max(created, this.store.now()) + 86400000);
        return answer;
      } catch (error) {
        // Keep uncertain writes pending; only definite rejections can be retried.
        if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) {
          this.store.delete(receiptKey);
          throw error;
        }
        throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
      }
    });
  }
  async comment(raw: C.CommentCall) {
    const input = parse(C.CommentCall, raw), request = input.request, c = await this.#context(request.config, input.session, true);
    return this.#write(c, request.key, ['comment', request], !request.replyToId, async discussion => {
      requireCondition(!discussion.locked, 403, 'LOCKED', 'This discussion is locked.');
      let replyId = request.replyToId;
      if (replyId) {
        const parent = await this.#target(c, discussion, replyId);
        requireCondition(parent.__typename === 'DiscussionComment', 400, 'BAD_INPUT', 'Replies need a comment ID.');
        replyId = parent.replyTo?.id || parent.id;
        if (parent.replyTo) { const root = await this.#target(c, discussion, replyId); requireCondition(root.__typename === 'DiscussionComment' && !root.replyTo, 403, 'PERMISSION', 'The reply does not have a valid top-level comment.'); }
      }
      const comment = await c.client.comment(discussion.id, request.body, replyId, c.token);
      return { id: comment.id, comment };
    });
  }
  async edit(raw: C.EditCall) {
    const input = parse(C.EditCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['edit', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && target.viewerCanUpdate, 403, 'PERMISSION', 'You cannot edit this comment.');
      const comment = await c.client.edit(r.id, r.body, c.token);
      return { id: comment.id, comment };
    });
  }
  async remove(raw: C.DeleteCall) {
    const input = parse(C.DeleteCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['delete', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && target.viewerCanDelete, 403, 'PERMISSION', 'You cannot delete this comment.');
      const comment = await c.client.remove(r.id, c.token);
      return comment?.deletedAt?{id:r.id,comment,rankingReplyTo:target.replyTo?.id??null}:{id:r.id,removed:true,rankingReplyTo:target.replyTo?.id??null};
    });
  }
  async reaction(raw: C.ReactionCall) {
    const input = parse(C.ReactionCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['reaction', r], r.id === 'discussion' && r.add, async discussion => {
      requireCondition(!discussion.locked, 403, 'LOCKED', 'This discussion is locked.');
      const id = r.id === 'discussion' ? discussion.id : r.id;
      const target=await this.#target(c,discussion,id);
      return {id,rankingReplyTo:target.__typename==='DiscussionComment'?target.replyTo?.id??null:null,reactions: await c.client.react(id, r.reaction, r.add, c.token) };
    });
  }
  async moderate(raw: C.ModerateCall) {
    const input = parse(C.ModerateCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['moderate', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && (r.minimized ? target.viewerCanMinimize : target.viewerCanUnminimize), 403, 'PERMISSION', 'You cannot moderate this comment.');
      await c.client.moderate(r.id, r.minimized, c.token, r.reason);
      const updated = await c.client.commentRefresh(r.id, c.token);
      discussionScope(updated.discussion, c.widget.repo, c.meta.id, c.categoryId);
      requireCondition(updated.id === r.id && updated.discussion.id === discussion.id, 403, 'PERMISSION', 'This comment does not belong to this page.');
      return { id: r.id, comment: updated };
    });
  }
  async authPrepare(raw: C.PrepareCall) { const input = parse(C.PrepareCall, raw); return this.#base(input.request.repo).auth.prepare(input); }
  async authCallback(raw: C.CallbackCall) { const input = parse(C.CallbackCall, raw); return this.#base(input.repo).auth.callback(input); }
  async authPoll(raw: R.AuthProof) { const input = parse(R.AuthProof, raw); return this.#base(input.repo).auth.poll(input); }
  async authConsume(raw: R.AuthConsume) { const input = parse(R.AuthConsume, raw); return this.#base(input.repo).auth.consume(input); }
  async logout(raw: C.LogoutCall) { const input = parse(C.LogoutCall, raw); return this.#base(input.request.repo).auth.logout(input.session, input.request.origin); }
}
