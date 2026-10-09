import {ReadCache} from './read-cache.js';
import {RankingEngine} from '../ranking/engine.js';
import {headQuery,discoveryQuery,observationQuery,parseHead,parseDiscovery,parseObservation,type RankingScope} from '../ranking/github.js';
import type {Source,Storage as RankingStorage} from '../ranking/types.js';
import type {EffectResult,ReadValue} from '../contracts/results.js';
import type {WindowPage,ContributionResult,CountObservation,AccessResult} from '../contracts/document.js';
import {configuration,secrets,type ConfigBindings,type RepositoryPolicy} from '../contracts/config.js';
import * as R from '../contracts/requests.js';
import * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import * as G from '../contracts/github.js';
import {countKey,countObservation as observeCount,type CountTarget} from '../contracts/count.js';
import {policy} from './authorization.js';
import {Auth,type AuthorizedSession} from './auth.js';
import {hash} from './crypto.js';
import {GitHub} from './github.js';
import {AppError,requireCondition,result,failure as importFailure,type Result,type Failure} from './errors.js';
import {Store} from './store.js';
export interface Registration {repositoryId:string;installationId:number;categoryId:string}
interface RepositoryContext {client:GitHub;policy:RepositoryPolicy;auth:Auth}
interface Lookup {repository:G.RepositoryHead;selected:G.DiscussionIdentity|null;count:number;observedAt:number}
interface ResolvedSelection {selection:{id?:string;number:number}|null;lookup?:Lookup}
export class RepositoryEngine {
  #reads=new ReadCache(()=>this.store.now());
  #context?:RepositoryContext;
  #ranking?:RankingEngine;
  #repositoryId?:string;
  constructor(readonly env:ConfigBindings,readonly store:Store,readonly rankingStorage?:RankingStorage){}
  /** HTTP owns input and website authorization. This internal call owns immutable actor identity. */
  execute<K extends C.Operation>(name:K,input:C.Input<K>,registration:Registration):Promise<Result<Output<K>>>{
    return result(async()=>{
      requireCondition(!this.#repositoryId||this.#repositoryId===registration.repositoryId,403,'PERMISSION','The repository object identity does not match.');
      this.#repositoryId=registration.repositoryId;
      const call=input as C.Input<C.Operation>,request='request'in call?call.request:call,repo='config'in request?request.config.repo:request.repo;
      const old=this.store.get('identity:v3',S.ActorIdentity);
      if(!old||old.repo!==repo)this.store.put('identity:v3',S.ActorIdentity,{repo,repositoryId:registration.repositoryId});
      const context=this.#base(repo,registration);
      return await (this[name] as(input:C.Input<K>,context:RepositoryContext)=>Promise<Output<K>>).call(this,input,context);
    }) as Promise<Result<Output<K>>>;
  }
  #base(repo:string,registration:Registration):RepositoryContext{
    const old=this.#context;
    if(old&&old.client.repo===repo&&old.client.installationId===registration.installationId&&old.client.categoryId===registration.categoryId)return old;
    if(old)this.#reads.invalidate(()=>true);
    const config=configuration(this.env),p={...policy(config,repo),...registration},keys=secrets(this.env),client=new GitHub(repo,registration.repositoryId,p.installationId,p.categoryId,config,keys,this.store);
    return this.#context={client,policy:p,auth:new Auth(config,keys,repo,registration.repositoryId,p,this.store,client)};
  }
  #mapping(selector:R.Selector,p:RepositoryPolicy){return 'mapping:v4:'+JSON.stringify([p.categoryId,selector.kind==='page'?['page',selector.key]:['discussion',selector.number]]);}
  #creationKey(key:string,p:RepositoryPolicy){return 'creating:mapping:v3:'+JSON.stringify([p.categoryId,true,key]);}
  #groupSelector(repo:string,selector:R.Selector){return JSON.stringify([repo,selector.kind==='page'?['page',selector.key]:['discussion',selector.number]]);}
  #group(w:R.Selection){return this.#groupSelector(w.repo,w.selector);}
  #remember(w:R.Selection,number:number){this.#reads.identify(this.#group(w),'discussion:'+number);}
  #invalidate(w:R.Selection,number:number){const group=this.#group(w);this.#reads.invalidate(g=>g===group||g==='discussion:'+number);}
  #rootTarget(w:R.Selection):CountTarget{return {selector:w.selector,window:{kind:'roots'}};}
  /** Counts, reading and commands share canonical discovery. Only public facts enter
   * pending reuse; account authority has its own acquisition. */
  #lookup(base:RepositoryContext,repo:string,targets:CountTarget[],token:()=>Promise<string>=()=>base.client.installation(),reserve?:()=>void):Promise<Lookup>[] {
    const missing=new Map<string,CountTarget>();let batch:Promise<Map<string,Lookup|Failure>>|undefined;
    const load=async()=>{
      const pages=[...missing].map(([key,target])=>({target,key,mapped:this.store.get(this.#mapping(target.selector,base.policy),S.Mapping)??undefined}));
      const credential=await token();reserve?.();
      const response=await base.client.counts(pages,credential);
      return new Map<string,Lookup|Failure>(pages.map((page,i)=>{
        const item=response.summaries[i]!;if(item&&'code'in item)return [page.key,item];
          const selected=item?.discussion??null;
          if(selected){this.store.put(this.#mapping(page.target.selector,base.policy),S.Mapping,{id:selected.id,number:selected.number});this.#reads.identify(this.#groupSelector(repo,page.target.selector),'discussion:'+selected.number);if(page.target.selector.kind==='page'&&page.target.window.kind==='roots')this.store.delete(this.#creationKey(page.target.selector.key,base.policy));}
          return [page.key,{repository:response.meta,selected,count:item?.count??0,observedAt:response.observedAt}];
      }));
    };
    return targets.map(target=>{
      const key=countKey(target),group=this.#groupSelector(repo,target.selector);
      const read=this.#reads.read<Lookup>('selection:'+base.policy.categoryId+':'+key,group,0,async()=>{
        missing.set(key,target);batch??=Promise.resolve().then(load);const value=(await batch).get(key)!;
        if('code'in value)throw new AppError(value.status,value.code,value.message,value.retryAfter,value.phase);return value;
      });
      const number=target.selector.kind==='discussion'?target.selector.number:this.store.get(this.#mapping(target.selector,base.policy),S.Mapping)?.number;
      if(number)this.#reads.identify(group,'discussion:'+number);
      return read.then(entry=>entry.value);
    });
  }
  async #resolveSelection(base:RepositoryContext,w:R.Selection):Promise<ResolvedSelection>{
    if(w.selector.kind==='discussion')return {selection:{number:w.selector.number,...(w.selector.id?{id:w.selector.id}:{})}};
    const p=base.policy,mapped=this.store.get(this.#mapping(w.selector,p),S.Mapping);
    if(mapped)return {selection:mapped};
    const lookup=await this.#lookup(base,w.repo,[this.#rootTarget(w)])[0]!;
    return {selection:lookup!.selected?{id:lookup!.selected.id,number:lookup!.selected.number}:null,lookup};
  }
  async #ensureDiscussion(base:RepositoryContext,w:R.Selection,selected:ResolvedSelection,session:AuthorizedSession,creation:R.ContributionRequest['creation']):Promise<{id?:string;number:number}>{
    if(selected.selection)return selected.selection;
    requireCondition(w.selector.kind==='page',400,'BAD_INPUT','Only an exact page key can create a discussion.');
    const key=this.#mapping(w.selector,base.policy),creating=this.#creationKey(w.selector.key,base.policy);
    return this.store.lock(key,async()=>{
      const mapped=this.store.get(key,S.Mapping);if(mapped)return mapped;
      requireCondition(selected.lookup&&!selected.lookup.repository.isArchived,403,'ARCHIVED','The repository is archived.');
      if(this.store.get(creating,S.Creation))throw new AppError(409,'WRITE_UNCERTAIN','GitHub may have created this discussion. Check the repository before creating another.',undefined,'unknown');
      this.store.limit('create:'+session.principal,10,3600000);
      const token=await base.client.installation();
      this.store.put(creating,S.Creation,{started:this.store.now()});
      try{
        const created=await base.client.create({...w,...creation},token);
        const identity={id:created.id,number:created.number};this.store.put(key,S.Mapping,identity);this.store.delete(creating);return identity;
      }catch(error){
        if(error instanceof AppError&&[400,401,403,404,429].includes(error.status))this.store.delete(creating);
        else if(error instanceof AppError)throw new AppError(error.status,error.code,error.message,error.retryAfter,'unknown');
        throw error;
      }
    });
  }
  async page(r:R.PageRequest,base:RepositoryContext):Promise<ReadValue<WindowPage>>{
    const w=r.config,p=base.policy;
    const load=async():Promise<WindowPage>=>{
      const resolved=await this.#resolveSelection(base,w);
      if(!resolved.selection){
        const lookup=resolved.lookup!,observedAt=lookup.observedAt;
        return {observedAt,nodes:{},window:{ids:[],cursor:null,count:observeCount(this.#rootTarget(w),0,null,observedAt,p.countCacheMs)},replies:{},metadata:{thread:null,archived:lookup.repository.isArchived,unavailable:false,profiles:Object.keys(p.ranking?.profiles??{})}};
      }
      const read='replyPrefetch'in r.read?{...r.read,replyPrefetch:Math.min(r.read.replyPrefetch,p.maxReplyPrefetch)}:r.read;
      this.#remember(w,resolved.selection.number);
      const page=await base.client.page(resolved.selection,{read,selector:w.selector,ttl:p.countCacheMs,profiles:Object.keys(p.ranking?.profiles??{}),html:r.content==='github'||r.content==='stock'},await base.client.installation());
      return page;
    };
    const key=JSON.stringify(['page',p.categoryId,w.selector,r.read,r.content==='github'||r.content==='stock']);
    if(r.fresh)this.#reads.forget(key);
    return this.#reads.read(key,this.#group(w),p.displayCacheMs,load);
  }
  async info(input:R.InfoRequest,base:RepositoryContext){const p=base.policy;return {value:{repo:input.repo,repoId:this.#repositoryId!,category:p.category,categoryId:p.categoryId,defaultCommentOrder:p.defaultCommentOrder,profiles:Object.keys(p.ranking?.profiles??{})},expires:this.store.now()+p.displayCacheMs};}
  async counts(input:R.CountsRequest,base:RepositoryContext){
    const targets=[...new Map(input.targets.map(target=>[countKey(target),target])).values()];
    const values=await Promise.allSettled(this.#lookup(base,input.repo,targets));
    const observations:Record<string,CountObservation>={},errors:Record<string,Failure>={};
    values.forEach((value,i)=>{
      const target=targets[i]!,key=countKey(target);
      if(value.status==='rejected'){errors[key]=importFailure(value.reason);return;}
      const lookup=value.value;observations[key]=observeCount(target,lookup.count,lookup.selected?{id:lookup.selected.id,number:lookup.selected.number}:null,lookup.observedAt,base.policy.countCacheMs);
    });
    return {value:{observations,...(Object.keys(errors).length?{errors}:{})},expires:Object.keys(errors).length?0:Math.min(...Object.values(observations).map(o=>o.expiresAt))};
  }
  async session(input:C.Input<'session'>,base:RepositoryContext){const session=await base.auth.identity(input.session,input.request.origin);return {principal:session?.principal??null,needsAuthorization:Boolean(session&&(!session.credentials||session.credentials.accessExpires<=this.store.now()+60000&&(!session.credentials.refreshToken||session.credentials.refreshExpires<=this.store.now())))};}
  async access(input:C.Input<'access'>,base:RepositoryContext):Promise<AccessResult>{
    const {config:w,ids}=input.request,session=await base.auth.session(input.session,w.origin,true);
    try{
    const resolved=await this.#resolveSelection(base,w);
    if(!resolved.selection){const principal=await base.client.viewer(session!.credentials.accessToken);requireCondition(principal.id===session!.principal,401,'SESSION','The account identity changed.');return {observedAt:resolved.lookup!.observedAt,principal,permissions:{},reactions:{},threadReactions:{},thread:null,archived:resolved.lookup!.repository.isArchived,unavailable:false};}
    const observed=await base.client.access(resolved.selection,ids,session!.credentials.accessToken);
    requireCondition(observed.principal.id===session!.principal,401,'SESSION','The account identity changed.');
    return observed;
    }catch(error){if(error instanceof AppError&&error.code==='GITHUB_AUTH')await base.auth.retire(input.session,w.origin,session!.credentials.accessToken);throw error;}
  }
    #ranker(repo: string): RankingEngine | undefined {
        if (this.#ranking)
            return this.#ranking;
        const config = configuration(this.env), selected = config.repositories[repo]?.ranking;
        if (!selected)
            return;
        requireCondition(this.rankingStorage, 503, 'CONFIGURATION', 'Ranking storage is unavailable.');
        const count = Object.values(config.repositories).filter(p => p.ranking).length, b = config.rankingBudget;
        requireCondition(Math.floor(b.maxRowsWrittenPerDay / count) >= 256 && Math.floor(b.maxRowsReadPerDay / count) >= 256 && Math.floor(b.maxRequestsPerHour / count) >= 1, 503, 'CONFIGURATION', 'The ranking allowance is too small for the configured repositories.');
        return this.#ranking = new RankingEngine(this.rankingStorage, { ...selected, maxRequestsPerHour: Math.floor(b.maxRequestsPerHour / count), maxRowsWrittenPerDay: Math.floor(b.maxRowsWrittenPerDay / count), maxRowsReadPerDay: Math.floor(b.maxRowsReadPerDay / count), maxOrderBytes: b.maxOrderBytes }, this.store.now);
    }
    #rankingSource(base:RepositoryContext,repo:string,discussionId:string): Source {
        const scope: RankingScope = {repo,repositoryId:this.#repositoryId!,discussionId,categoryId:base.policy.categoryId};
        const read = async (spec: {
            query: string;
            variables: Record<string, unknown>;
        }) => base.client.rankingGraph(spec.query, spec.variables, await base.client.installation(() => this.#ranker(repo)!.allowRequests(1)));
        return { head:async()=>{const observedAt=this.store.now();return parseHead(await read(headQuery(scope)),scope,observedAt,Object.keys(base.policy.ranking?.profiles??{}));}, discover: async (cursor, inputs) => parseDiscovery(await read(discoveryQuery(scope, cursor, inputs)), scope, inputs), observe: async (ids, inputs) => parseObservation(await read(observationQuery(ids, inputs)), ids, scope, inputs) };
    }
    async ranking(input:C.Input<'ranking'>,base:RepositoryContext) {
        const w = input.request.config, ranker = this.#ranker(w.repo);
        requireCondition(ranker && Object.hasOwn(ranker.options.profiles, input.request.profile), 400, 'BAD_INPUT', 'This ranking profile is not enabled.');
        try {
            const key=this.#mapping(w.selector,base.policy);
            let identity=w.selector.kind==='discussion'&&w.selector.id?{id:w.selector.id,number:w.selector.number}:this.store.get(key,S.Mapping);
            if(!identity){const lookup=await this.#lookup(base,w.repo,[this.#rootTarget(w)],()=>base.client.installation(()=>ranker.allowRequests()),()=>ranker.allowRequests())[0]!;if(!lookup!.selected){const observedAt=lookup!.observedAt;return {status:'ready' as const,ids:[],interval:{started:observedAt,completed:observedAt},nextRefreshAt:observedAt+ranker.options.refreshSeconds*1000,revision:0,target:{observedAt,metadata:{thread:null,archived:lookup!.repository.isArchived,unavailable:false,profiles:Object.keys(base.policy.ranking?.profiles??{})},count:observeCount(this.#rootTarget(w),0,null,observedAt,base.policy.countCacheMs)}};}identity={id:lookup!.selected.id,number:lookup!.selected.number};}
            const result=await ranker.request(identity.id,input.request.profile,this.#rankingSource(base,w.repo,identity.id)),target=ranker.target(identity.id);
            return {...result,...(target?{target:{metadata:target.metadata,observedAt:target.observedAt,count:observeCount(this.#rootTarget(w),target.rootCount,{id:identity.id,number:identity.number},target.observedAt,base.policy.countCacheMs)}}:{})};
        }
        catch (error) {
            if (error instanceof AppError && error.code === 'RANKING_BUDGET')
                return { status: 'paused' as const, reason: 'budget' as const, retryAt: this.store.now() + (error.retryAfter ?? 60) * 1000 };
            throw error;
        }
    }
    async continueRanking() { const identity = this.store.get('identity:v3', S.ActorIdentity); if (identity) {
        this.#repositoryId=identity.repositoryId;const registration=configuration(this.env).repositories[identity.repo];if(registration){const base=this.#base(identity.repo,registration);await this.#ranker(identity.repo)?.continueJobs(id=>this.#rankingSource(base,identity.repo,id));}
    } }
    rankingAlarm() { return this.#ranking?.nextAlarmAt() ?? null; }
    /** The selected provider interprets supplied text; this grants no participation or repository read authority. */
    async interpret(input:C.Input<'interpret'>,base:RepositoryContext):Promise<import('../contracts/content.js').ContentBatchResult>{
      const {inputs}=input;let token:string;
      try{token=await base.client.installation();this.store.limit('content-interpretation',120,60000);}
      catch(error){return {results:inputs.map(()=>({error:importFailure(error).message}))};}
      return {results:await Promise.all(inputs.map(async value=>{
        try{return {html:await base.client.markdown(value.markdown,token)};}
        catch(error){return {error:importFailure(error).message};}
      }))};
    }
    async contribute(input:C.Input<'contribute'>,base:RepositoryContext): Promise<ContributionResult> {
        const r = input.request, w = r.config, action = r.action;
        const identity=await base.auth.identity(input.session,w.origin,true);
        const selected=w.selector.kind==='page'?{repo:w.repo,term:w.selector.key,strict:true}:{repo:w.repo,number:w.selector.number};
        const intent = { selection: selected, action };
        const receiptKey = 'receipt:v3:' + await hash(r.key), fingerprint = await hash(JSON.stringify(intent)), owner=identity!.principal;
        let issuedToken:string|undefined;
        return this.store.lock(receiptKey, async () => {
            const receipt = this.store.get(receiptKey, S.Receipt);
            if (receipt) {
                requireCondition(receipt.owner === owner, 409, 'CONFLICT', 'This submission belongs to another GitHub account.');
                requireCondition(receipt.fingerprint === fingerprint, 409, 'CONFLICT', 'This request ID was used for different content.');
                if(!receipt.result)throw new AppError(409,'WRITE_UNCERTAIN','GitHub may have saved this change. Check the discussion before submitting it again.',undefined,'unknown');
                const {patch,...confirmation}=receipt.result;return {phase:'confirmed' as const,replayed:true,...confirmation,...(patch?.observedAt?{patch}:{})};
            }
            const created = Number(r.key.split('.')[1]);
            requireCondition(Number.isSafeInteger(created) && created <= this.store.now() + 300000 && this.store.now() - created < 86400000, 409, 'OPERATION_EXPIRED', 'This submission is too old to retry. Check the discussion before submitting again.');
            const session=await base.auth.session(input.session,w.origin,true);issuedToken=session!.credentials.accessToken;
            requireCondition(session!.principal===owner,401,'SESSION','The account identity changed.');
            const create = action.type === 'comment' && !action.replyToId || action.type === 'reaction' && action.subject.kind === 'discussion' && action.selected;
            const resolved=await this.#resolveSelection(base,w);
            const selected=create?await this.#ensureDiscussion(base,w,resolved,session!,r.creation):resolved.selection;
            requireCondition(selected,404,'NOT_FOUND','Discussion not found.');
            const a=await base.client.targetAccess(selected,action,session!.credentials.accessToken);
            this.#remember(w,a.discussion.number);
            const {targetId,parentId}=a;
            this.store.limit('write:' + owner, 30, 60000);
            this.store.limit('all-writes', 180, 60000);
            const expires = Math.max(created, this.store.now()) + 86400000;
            this.store.put(receiptKey, S.Receipt, {owner,fingerprint,result:null}, expires);
            let effect: EffectResult;
            try {
                const observedAt=this.store.now();
                const confirmed=await base.client.contribute(action, a.discussion.id, targetId, parentId, session!.credentials.accessToken, (r.content==='github'||r.content==='stock'));
                const {rootCount,replyCount,account,...confirmation}=confirmed;
                effect={...confirmation,...(account?{account:{...account,principal:owner,observedAt}}:{}),number:a.discussion.number,...(parentId?{parentId}:{})};
                if(!effect.patch&&(action.type==='comment'||action.type==='delete'))effect.patch={};
                if(effect.patch){effect.patch.observedAt=observedAt;const invalidatedCounts:CountTarget[]=[];if((action.type==='comment'||action.type==='delete')&&!parentId&&rootCount===undefined)invalidatedCounts.push(this.#rootTarget(w));if((action.type==='comment'||action.type==='delete')&&parentId&&replyCount===undefined)invalidatedCounts.push({selector:w.selector,window:{kind:'replies',parentId}});if(invalidatedCounts.length)effect.patch.invalidatedCounts=invalidatedCounts;if(rootCount!==undefined)effect.patch.roots={...effect.patch.roots,count:observeCount(this.#rootTarget(w),rootCount,{id:a.discussion.id,number:a.discussion.number},observedAt,base.policy.countCacheMs)};if(replyCount!==undefined&&parentId)effect.patch.replies={...effect.patch.replies,[parentId]:{...effect.patch.replies?.[parentId],count:observeCount({selector:w.selector,window:{kind:'replies',parentId}},replyCount,{id:a.discussion.id,number:a.discussion.number},observedAt,base.policy.countCacheMs)}};}
                if (create && effect.patch) effect.patch = { ...effect.patch, metadata: { thread: a.discussion, archived:a.archived, unavailable: false, profiles: Object.keys(base.policy.ranking?.profiles ?? {}) } };
                this.store.put(receiptKey, S.Receipt, {owner,fingerprint,result:effect}, expires);
            }
            catch (error) {
                if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) {
                    this.store.delete(receiptKey);
                    throw error;
                }
                throw new AppError(502,'WRITE_UNCERTAIN','GitHub may have saved this change. Check the discussion before submitting it again.',undefined,'unknown');
            }
            finally {
                this.#invalidate(w, a.discussion.number);
            }
            if (action.type === 'reaction' && !parentId && action.subject.kind === 'comment') {
                const count = effect.patch?.reactions?.[effect.id]?.[action.reaction]?.count;
                if (count !== undefined) try { this.#ranker(w.repo)?.reaction(a.discussion.id, effect.id, action.reaction, count); }
                catch { /* Acquisition cadence and its budget remain independent of interactive completion. */ }
            }
            return {phase:'confirmed' as const,replayed:false,...effect};
        }).catch(async error=>{if(issuedToken&&error instanceof AppError&&error.code==='GITHUB_AUTH')await base.auth.retire(input.session,w.origin,issuedToken);throw error;});
    }
    authPrepare(input:C.Input<'authPrepare'>,base:RepositoryContext){return base.auth.prepare(input);}
    authCallback(input:C.Input<'authCallback'>,base:RepositoryContext){return base.auth.callback(input);}
    logout(input:C.Input<'logout'>,base:RepositoryContext){return base.auth.logout(input.session,input.request.origin);}
}
export type Output<K extends C.Operation> = Awaited<ReturnType<RepositoryEngine[K]>>;
