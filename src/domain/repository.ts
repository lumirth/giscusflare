import type {ProviderCoordination} from './provider.js';
import {ReadCache} from './read-cache.js';
import {RankingEngine} from '../ranking/engine.js';
import {headQuery,discoveryQuery,observationQuery,parseHead,parseDiscovery,parseObservation,type RankingScope} from '../ranking/github.js';
import type {Source,Storage as RankingStorage} from '../ranking/types.js';
import type {EffectResult,ReadValue} from '../contracts/results.js';
import type {WindowPage,ContributionResult,CountObservation,AccessResult,Discussion} from '../contracts/document.js';
import {configuration,secrets,type ConfigBindings,type RepositoryPolicy} from '../contracts/config.js';
import * as R from '../contracts/requests.js';
import type * as C from '../contracts/rpc.js';
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
interface RepositorySetup {client:GitHub;policy:RepositoryPolicy;auth:Auth}
interface RepositoryContext extends RepositorySetup {session:string;browserCookie:string}
interface Lookup {repository:G.RepositoryHead;selected:G.DiscussionIdentity|null;count:number;observedAt:number}
interface ResolvedSelection {selection:{id?:string;number:number;created?:{thread:Discussion;observedAt:number}}|null;lookup?:Lookup}
export class RepositoryEngine {
  #reads:ReadCache;
  #context?:RepositorySetup;
  #ranking?:RankingEngine;
  #repositoryId?:string;
  constructor(readonly env:ConfigBindings,readonly store:Store,readonly rankingStorage?:RankingStorage,readonly provider?:ProviderCoordination,readonly background:(work:Promise<unknown>)=>void=work=>{void work.catch(()=>undefined);}){this.#reads=new ReadCache(store,background);}
  /** HTTP owns input and website authorization. This internal call owns immutable actor identity. */
  execute<K extends C.Operation>(name:K,input:C.Input<K>,registration:Registration,authority:C.Authority={}):Promise<Result<Output<K>>>{
    return result(async()=>{
      requireCondition(!this.#repositoryId||this.#repositoryId===registration.repositoryId,403,'PERMISSION','The repository object identity does not match.');
      this.#repositoryId=registration.repositoryId;
      const request=input as C.Input<C.Operation>,repo='config'in request?request.config.repo:request.repo;
      const old=this.store.get('identity:v3',S.ActorIdentity);
      if(!old||old.repo!==repo)this.store.put('identity:v3',S.ActorIdentity,{repo,repositoryId:registration.repositoryId});
      const base=this.#base(repo,registration),client=base.client.forRequest(authority.requestId),context={...base,client,auth:new Auth(client.config,client.keys,repo,registration.repositoryId,base.policy,this.store,client),session:authority.session??'',browserCookie:authority.browserCookie??''};
      return await (this[name] as(input:C.Input<K>,context:RepositoryContext)=>Promise<Output<K>>).call(this,input,context);
    }) as Promise<Result<Output<K>>>;
  }
  #base(repo:string,registration:Registration):RepositorySetup{
    const old=this.#context;
    if(old&&old.client.repo===repo&&old.client.installationId===registration.installationId&&old.client.categoryId===registration.categoryId)return old;
    if(old)this.#reads.invalidate();
    const config=configuration(this.env),p={...policy(config,repo),...registration},keys=secrets(this.env),client=new GitHub(repo,registration.repositoryId,p.installationId,p.categoryId,config,keys,this.store,this.provider);
    return this.#context={client,policy:p,auth:new Auth(config,keys,repo,registration.repositoryId,p,this.store,client)};
  }
  #mapping(selector:R.Selector,p:RepositoryPolicy){return 'mapping:v4:'+JSON.stringify([p.categoryId,selector.kind==='page'?['page',selector.key]:['discussion',selector.number]]);}
  #creationKey(key:string,p:RepositoryPolicy){return 'creating:mapping:v3:'+JSON.stringify([p.categoryId,true,key]);}
  #groupSelector(repo:string,selector:R.Selector){return JSON.stringify([repo,selector.kind==='page'?['page',selector.key]:['discussion',selector.number]]);}
  #group(w:R.Selection){return this.#groupSelector(w.repo,w.selector);}
  #remember(w:R.Selection,number:number){this.#reads.identify(this.#group(w),'discussion:'+number);}
  #invalidate(w:R.Selection,number:number){const group=this.#group(w);this.#reads.invalidate([group,'discussion:'+number]);}
  #rootTarget(w:R.Selection):CountTarget{return {selector:w.selector,window:{kind:'roots'}};}
  /** Counts, reading and commands share canonical discovery. Only public facts enter
   * pending reuse; account authority has its own acquisition. */
  #lookup(base:RepositorySetup,repo:string,targets:CountTarget[],token:()=>Promise<string>=()=>base.client.installation(),reserve?:()=>void,fresh=false):Promise<Lookup>[] {
    const missing=new Map<string,CountTarget>();let batch:Promise<Map<string,Lookup|Failure>>|undefined;
    const load=async()=>{
      const pages=[...missing].map(([key,target])=>({target,key,mapped:this.store.get(this.#mapping(target.selector,base.policy),S.Mapping)??undefined}));
      const credential=await token();reserve?.();
      const response=await base.client.counts(pages,credential);
      return new Map<string,Lookup|Failure>(pages.map((page,i)=>{
        const item=response.summaries[i]!;if(item&&'code'in item)return [page.key,item];
          const selected=item?.discussion??null;

          return [page.key,{repository:response.meta,selected,count:item?.count??0,observedAt:response.observedAt}];
      }));
    };
    return targets.map(target=>{
      const key=countKey(target),group=this.#groupSelector(repo,target.selector);
      const read=this.#reads.read<Lookup>('selection:'+base.policy.categoryId+':'+key,group,base.policy.countCacheMs,async()=>{
        missing.set(key,target);batch??=Promise.resolve().then(load);const value=(await batch).get(key)!;
        if('code'in value)throw new AppError(value.status,value.code,value.message,value.retryAfter,value.phase,value.rateKind);return value;
      },{fresh,retention:base.policy.outageRetentionMs,accept:lookup=>{if(lookup.selected){this.store.put(this.#mapping(target.selector,base.policy),S.Mapping,{id:lookup.selected.id,number:lookup.selected.number});this.#reads.identify(group,'discussion:'+lookup.selected.number);if(target.selector.kind==='page'&&target.window.kind==='roots')this.store.delete(this.#creationKey(target.selector.key,base.policy));}}});
      const number=target.selector.kind==='discussion'?target.selector.number:this.store.get(this.#mapping(target.selector,base.policy),S.Mapping)?.number;
      if(number)this.#reads.identify(group,'discussion:'+number);
      return read.then(entry=>entry.value);
    });
  }
  async #resolveSelection(base:RepositorySetup,w:R.Selection,token?:()=>Promise<string>,fresh=false):Promise<ResolvedSelection>{
    if(w.selector.kind==='discussion')return {selection:{number:w.selector.number,...(w.selector.id?{id:w.selector.id}:{})}};
    const p=base.policy,mapped=this.store.get(this.#mapping(w.selector,p),S.Mapping);
    if(mapped)return {selection:mapped};
    const lookup=await this.#lookup(base,w.repo,[this.#rootTarget(w)],token,undefined,fresh)[0]!;
    return {selection:lookup!.selected?{id:lookup!.selected.id,number:lookup!.selected.number}:null,lookup};
  }
  async #ensureDiscussion(base:RepositoryContext,w:R.Selection,selected:ResolvedSelection,session:AuthorizedSession,creation:R.ContributionRequest['creation']):Promise<NonNullable<ResolvedSelection['selection']>>{
    if(selected.selection)return selected.selection;
    requireCondition(w.selector.kind==='page',400,'BAD_INPUT','Only an exact page key can create a discussion.');
    const key=this.#mapping(w.selector,base.policy),creating=this.#creationKey(w.selector.key,base.policy);
    return this.store.lock(key,async()=>{
      const mapped=this.store.get(key,S.Mapping);if(mapped)return mapped;
      const checked=await this.#lookup(base,w.repo,[this.#rootTarget(w)],()=>Promise.resolve(session.credentials.accessToken),undefined,true)[0]!;
      if(checked?.selected)return {id:checked.selected.id,number:checked.selected.number};
      requireCondition(checked&&!checked.repository.isArchived,403,'ARCHIVED','The repository is archived.');
      if(this.store.get(creating,S.Creation))throw new AppError(409,'WRITE_UNCERTAIN','GitHub may have created this discussion. Check the repository before creating another.',undefined,'unknown');
      this.store.limit('create:'+session.principal,10,3600000);
      const token=await base.client.installation();
      this.store.put(creating,S.Creation,{started:this.store.now()});
      try{
        const created=await base.client.create({...w,...creation},token);
        const identity={id:created.thread.id,number:created.thread.number};this.store.put(key,S.Mapping,identity);this.store.delete(creating);return {...identity,created};
      }catch(error){
        if(error instanceof AppError&&[400,401,403,404,429].includes(error.status))this.store.delete(creating);
        else if(error instanceof AppError)throw new AppError(error.status,error.code,error.message,error.retryAfter,'unknown');
        throw error;
      }
    });
  }
  #applyEffect(w:R.Selection,number:number,effect:EffectResult):void{
    const patch=effect.patch,group=this.#group(w);
    this.#reads.update([group,'discussion:'+number],(value,key)=>{
      if(!patch)return undefined;
      if(key.startsWith('selection:')){
        const lookup=value as Lookup;
        const serialized=key.slice(key.indexOf(':',10)+1);
        const observation=[patch.roots?.count,...Object.values(patch.replies??{}).map(window=>window.count)].find(count=>count&&countKey(count.target)===serialized);
        if(observation)return {...lookup,count:observation.count,observedAt:observation.observedAt,selected:observation.discussion?{...observation.discussion,repository:{id:this.#repositoryId!,nameWithOwner:w.repo,isPrivate:false},category:{id:this.#context!.policy.categoryId}}:null};
        if(patch.invalidatedCounts?.some(count=>countKey(count)===serialized))return undefined;
        return value;
      }
      const page=value as WindowPage,read=JSON.parse(key)[3] as R.ReadIntent;
      for(const [id,node]of Object.entries(patch.nodes??{})){
        if(node===null){delete page.nodes[id];delete page.contentHints?.[id];page.window.ids=page.window.ids.filter(item=>item!==id);for(const window of Object.values(page.replies??{}))window.ids=window.ids.filter(item=>item!==id);}
        else if(page.nodes[id]){page.nodes[id]={...page.nodes[id],...node};if(node.body!==undefined)delete page.contentHints?.[id];}
      }
      for(const [id,reactions]of Object.entries(patch.reactions??{})){
        if(page.nodes[id])page.nodes[id]!.reactions={...page.nodes[id]!.reactions,...reactions};
        else if(page.metadata?.thread?.id===id)page.metadata.thread.reactions={...page.metadata.thread.reactions,...reactions};
      }
      const updateWindow=(window:WindowPage['window'],delta:NonNullable<typeof patch.roots>|undefined,order='oldest',extend=false)=>{
        if(!delta)return;
        const complete=window.count?.count===window.ids.length;
        window.ids=window.ids.filter(id=>!delta.remove?.includes(id));
        if(extend&&(complete||order==='newest'))for(const id of delta.add??[]){const node=patch.nodes?.[id];if(node&&'id'in node&&node.id===id){page.nodes[id]=node as import('../contracts/document.js').Comment;window.ids=order==='newest'?[id,...window.ids.filter(item=>item!==id)]:[...window.ids.filter(item=>item!==id),id];}}
        if(delta.count)window.count=delta.count;
      };
      updateWindow(page.window,read.kind==='replies'?patch.replies?.[read.parentId]:patch.roots,read.kind==='roots'?read.order:'oldest',read.kind==='roots'&&!read.cursor||read.kind==='replies'&&!read.cursor);
      for(const [id,window]of Object.entries(page.replies??{}))updateWindow(window,patch.replies?.[id],'newest',true);
      for(const [id,hint]of Object.entries(patch.contentHints??{}))if(page.nodes[id]?.body===hint.markdown)(page.contentHints??={})[id]=hint;
      if(patch.metadata&&page.metadata){const thread=patch.metadata.thread;page.metadata={...page.metadata,...patch.metadata,thread:thread===null?null:thread?{...page.metadata.thread!,...thread}:page.metadata.thread};}
      return page;
    });
  }
  /** Signed deliveries are hints for reconciliation; they do not manufacture an ordered replica. */
  webhook(input:{delivery:string;event:string;action:string;number?:number;comment?:string;withdraw?:boolean;deleted?:boolean},registration:Registration,repo:string):void{
    const key='webhook:'+input.delivery;
    if(this.store.get(key,S.Creation))return;
    this.store.put(key,S.Creation,{started:this.store.now()},this.store.now()+86400000);
    this.#repositoryId=registration.repositoryId;
    const base=this.#base(repo,registration);
    const matches=input.withdraw||input.event==='discussion'&&input.action==='created'?undefined:['discussion:'+input.number];
    if(input.withdraw){this.#reads.invalidate();return;}
    if(input.deleted&&input.number){
      this.#reads.invalidate(matches);
      for(const row of this.store.sql.exec("SELECT key,value FROM records WHERE key LIKE 'mapping:v4:%'")){const identity=JSON.parse(String(row.value));if(identity.number===input.number)this.store.delete(String(row.key));}
      return;
    }
    if(input.event==='discussion_comment'&&['deleted','minimized'].includes(input.action)&&input.comment){
      this.#reads.update(matches,(value,key)=>{
        if(!key.startsWith('['))return value;
        const page=value as WindowPage,node=page.nodes[input.comment!];
        if(node){node.body='';node.isMinimized=true;delete page.contentHints?.[input.comment!];}
        return page;
      });
    }
    this.#reads.dirty(matches);
    console.info(JSON.stringify({event:'webhook_accepted',delivery:input.delivery,kind:input.event,action:input.action,number:input.number}));
  }
  async #publicAcquisition<T>(base:RepositoryContext,origin:string,read:(token:string)=>Promise<T>):Promise<T>{
    const token=await this.#readCredential(base,origin);
    try{return await read(token);}
    catch(error){
      if(base.session&&base.client.isUser(token)&&error instanceof AppError&&([401,403,404].includes(error.status)&&['GITHUB_AUTH','PERMISSION','NOT_FOUND'].includes(error.code)||error.status===429&&error.rateKind==='primary')){
        if(error.code==='GITHUB_AUTH')await base.auth.retire(base.session,origin,token);
        return read(await base.client.installation());
      }
      throw error;
    }
  }
  async #readCredential(base:RepositoryContext,origin:string):Promise<string>{
    if(base.session){
      try{
        const local=await base.auth.identity(base.session,origin);
        if(local?.credentials&&local.credentials.accessExpires>this.store.now()+60000){base.client.authorize(local.credentials.accessToken,local.principal);return local.credentials.accessToken;}
      }catch(error){if(!(error instanceof AppError&&['SESSION','AUTH_REQUIRED'].includes(error.code)))throw error;}
    }
    return base.client.installation();
  }
  #seedPage(base:RepositorySetup,w:R.Selection,page:WindowPage):void{
    if(!page.metadata)return;
    const metadata=page.metadata,root=page.window.count;
    const seed=(observation:CountObservation|null|undefined)=>{
      if(!observation)return;
      const selected=metadata.thread;
      const lookup:Lookup={repository:{id:this.#repositoryId!,nameWithOwner:w.repo,isPrivate:false,isArchived:metadata.archived},selected:selected?{id:selected.id,number:selected.number,repository:{id:this.#repositoryId!,nameWithOwner:w.repo,isPrivate:false},category:{id:base.policy.categoryId}}:null,count:observation.count,observedAt:observation.observedAt};
      const group=this.#groupSelector(w.repo,observation.target.selector);
      this.#reads.seed('selection:'+base.policy.categoryId+':'+countKey(observation.target),group,lookup,observation.expiresAt,base.policy.outageRetentionMs,selected?'discussion:'+selected.number:undefined);
    };
    seed(root);for(const window of Object.values(page.replies??{}))seed(window.count);
  }
  async page(r:R.PageRequest,base:RepositoryContext):Promise<ReadValue<WindowPage>>{
    const w=r.config,p=base.policy;
    const load=async():Promise<WindowPage>=>this.#publicAcquisition(base,w.origin,async token=>{
      const credential=()=>Promise.resolve(token);
      const resolved=await this.#resolveSelection(base,w,credential);
      if(!resolved.selection){
        const lookup=resolved.lookup!,observedAt=lookup.observedAt;
        return {observedAt,nodes:{},window:{ids:[],cursor:null,count:observeCount(this.#rootTarget(w),0,null,observedAt,p.countCacheMs)},replies:{},metadata:{thread:null,archived:lookup.repository.isArchived,unavailable:false,profiles:Object.keys(p.ranking?.profiles??{})}};
      }
      const read='replyPrefetch'in r.read?{...r.read,replyPrefetch:Math.min(r.read.replyPrefetch,p.maxReplyPrefetch)}:r.read;
      this.#remember(w,resolved.selection.number);
      const page=await base.client.page(resolved.selection,{read,selector:w.selector,ttl:p.countCacheMs,profiles:Object.keys(p.ranking?.profiles??{}),html:r.providerHTML},await credential());
      return page;
    });
    const key=JSON.stringify(['page',p.categoryId,w.selector,r.read,r.providerHTML]);
    return this.#reads.read(key,this.#group(w),p.displayCacheMs,load,{fresh:r.fresh,retention:p.outageRetentionMs,accept:page=>this.#seedPage(base,w,page)});
  }
  async info(input:R.InfoRequest,base:RepositoryContext){const p=base.policy;return {value:{repo:input.repo,repoId:this.#repositoryId!,category:p.category,categoryId:p.categoryId,defaultCommentOrder:p.defaultCommentOrder,profiles:Object.keys(p.ranking?.profiles??{})},expires:this.store.now()+p.displayCacheMs};}
  async counts(input:R.CountsRequest,base:RepositoryContext){
    const targets=[...new Map(input.targets.map(target=>[countKey(target),target])).values()];
    const values=await Promise.allSettled(this.#lookup(base,input.repo,targets,undefined,undefined,input.fresh));
    const observations:Record<string,CountObservation>={},errors:Record<string,Failure>={};
    values.forEach((value,i)=>{
      const target=targets[i]!,key=countKey(target);
      if(value.status==='rejected'){errors[key]=importFailure(value.reason);return;}
      const lookup=value.value;observations[key]=observeCount(target,lookup.count,lookup.selected?{id:lookup.selected.id,number:lookup.selected.number}:null,lookup.observedAt,base.policy.countCacheMs);
    });
    return {value:{observations,...(Object.keys(errors).length?{errors}:{})},expires:Object.keys(errors).length?0:Math.min(...Object.values(observations).map(o=>o.expiresAt))};
  }
  async session(input:C.Input<'session'>,base:RepositoryContext){const session=await base.auth.identity(base.session,input.origin);return {principal:session?.principal??null,profile:session?base.auth.profile(session.principal):null,needsAuthorization:Boolean(session&&(!session.credentials||session.credentials.accessExpires<=this.store.now()+60000&&(!session.credentials.refreshToken||session.credentials.refreshExpires<=this.store.now())))};}
  async identity(input:C.Input<'identity'>,base:RepositoryContext){
    const session=await base.auth.session(base.session,input.origin,true);
    try{
      const viewer=await base.client.identity(session!.credentials.accessToken);
      requireCondition(viewer.id===session!.principal,401,'SESSION','The account identity changed.');
      return {principal:viewer.id,profile:base.auth.remember(viewer)};
    }catch(error){if(error instanceof AppError&&error.code==='GITHUB_AUTH')await base.auth.retire(base.session,input.origin,session!.credentials.accessToken);throw error;}
  }
  async access(input:C.Input<'access'>,base:RepositoryContext):Promise<AccessResult>{
    const {config:w,ids}=input,session=await base.auth.session(base.session,w.origin,true);
    try{
    const resolved=await this.#resolveSelection(base,w);
    if(!resolved.selection){const principal=await base.client.principal(session!.credentials.accessToken);requireCondition(principal===session!.principal,401,'SESSION','The account identity changed.');return {observedAt:resolved.lookup!.observedAt,principal,permissions:{},reactions:{},threadReactions:{},availability:{thread:null,archived:resolved.lookup!.repository.isArchived,unavailable:false}};}
    const observed=await base.client.access(resolved.selection,ids,session!.credentials.accessToken);
    requireCondition(observed.principal===session!.principal,401,'SESSION','The account identity changed.');
    return observed;
    }catch(error){if(error instanceof AppError&&error.code==='GITHUB_AUTH')await base.auth.retire(base.session,w.origin,session!.credentials.accessToken);throw error;}
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
    #rankingSource(base:RepositorySetup,repo:string,discussionId:string): Source {
        const scope: RankingScope = {repo,repositoryId:this.#repositoryId!,discussionId,categoryId:base.policy.categoryId};
        const read = async (spec: {
            query: string;
            variables: Record<string, unknown>;
        }) => base.client.rankingGraph(spec.query, spec.variables, await base.client.installation(() => this.#ranker(repo)!.allowRequests(1)));
        return { head:async()=>{const observedAt=this.store.now();return parseHead(await read(headQuery(scope)),scope,observedAt,Object.keys(base.policy.ranking?.profiles??{}));}, discover: async (cursor, inputs) => parseDiscovery(await read(discoveryQuery(scope, cursor, inputs)), scope, inputs), observe: async (ids, inputs) => parseObservation(await read(observationQuery(ids, inputs)), ids, scope, inputs) };
    }
    async ranking(input:C.Input<'ranking'>,base:RepositoryContext) {
        const w = input.config, ranker = this.#ranker(w.repo);
        requireCondition(ranker && Object.hasOwn(ranker.options.profiles, input.profile), 400, 'BAD_INPUT', 'This ranking profile is not enabled.');
        try {
            const key=this.#mapping(w.selector,base.policy);
            let identity=w.selector.kind==='discussion'&&w.selector.id?{id:w.selector.id,number:w.selector.number}:this.store.get(key,S.Mapping);
            if(!identity){const lookup=await this.#lookup(base,w.repo,[this.#rootTarget(w)],()=>base.client.installation(()=>ranker.allowRequests()),()=>ranker.allowRequests())[0]!;if(!lookup!.selected){const observedAt=lookup!.observedAt;return {status:'ready' as const,ids:[],interval:{started:observedAt,completed:observedAt},nextRefreshAt:observedAt+ranker.options.refreshSeconds*1000,revision:0,target:{observedAt,metadata:{thread:null,archived:lookup!.repository.isArchived,unavailable:false,profiles:Object.keys(base.policy.ranking?.profiles??{})},count:observeCount(this.#rootTarget(w),0,null,observedAt,base.policy.countCacheMs)}};}identity={id:lookup!.selected.id,number:lookup!.selected.number};}
            const result=await ranker.request(identity.id,input.profile,this.#rankingSource(base,w.repo,identity.id)),target=ranker.target(identity.id);
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
        const r = input, w = r.config, action = r.action;
        const identity=await base.auth.identity(base.session,w.origin,true);
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
            const session=await base.auth.session(base.session,w.origin,true);issuedToken=session!.credentials.accessToken;
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
                const confirmed=await base.client.contribute(action, a.discussion.id, targetId, parentId, session!.credentials.accessToken, (r.providerHTML));
                const {rootCount,replyCount,account,...confirmation}=confirmed;
                effect={...confirmation,...(account?{account:{...account,principal:owner,observedAt}}:{}),number:a.discussion.number,...(parentId?{parentId}:{})};
                if(!effect.patch&&(action.type==='comment'||action.type==='delete'))effect.patch={};
                if(effect.patch){effect.patch.observedAt=observedAt;const invalidatedCounts:CountTarget[]=[];if((action.type==='comment'||action.type==='delete')&&!parentId&&rootCount===undefined)invalidatedCounts.push(this.#rootTarget(w));if((action.type==='comment'||action.type==='delete')&&parentId&&replyCount===undefined)invalidatedCounts.push({selector:w.selector,window:{kind:'replies',parentId}});if(invalidatedCounts.length)effect.patch.invalidatedCounts=invalidatedCounts;if(rootCount!==undefined)effect.patch.roots={...effect.patch.roots,count:observeCount(this.#rootTarget(w),rootCount,{id:a.discussion.id,number:a.discussion.number},observedAt,base.policy.countCacheMs)};if(replyCount!==undefined&&parentId)effect.patch.replies={...effect.patch.replies,[parentId]:{...effect.patch.replies?.[parentId],count:observeCount({selector:w.selector,window:{kind:'replies',parentId}},replyCount,{id:a.discussion.id,number:a.discussion.number},observedAt,base.policy.countCacheMs)}};}
                if (selected.created) effect.patch={...effect.patch,metadata:{thread:selected.created.thread},metadataObservedAt:selected.created.observedAt};
                this.store.put(receiptKey, S.Receipt, {owner,fingerprint,result:effect}, expires);
                this.#applyEffect(w,a.discussion.number,effect);
            }
            catch (error) {
                if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) {
                    this.store.delete(receiptKey);
                    throw error;
                }
                this.#invalidate(w,a.discussion.number);
                throw new AppError(502,'WRITE_UNCERTAIN','GitHub may have saved this change. Check the discussion before submitting it again.',undefined,'unknown');
            }

            if (action.type === 'reaction' && !parentId && action.subject.kind === 'comment') {
                const count = effect.patch?.reactions?.[effect.id]?.[action.reaction]?.count;
                if (count !== undefined) try { this.#ranker(w.repo)?.reaction(a.discussion.id, effect.id, action.reaction, count); }
                catch { /* Acquisition cadence and its budget remain independent of interactive completion. */ }
            }
            return {phase:'confirmed' as const,replayed:false,...effect};
        }).catch(async error=>{if(issuedToken&&error instanceof AppError&&error.code==='GITHUB_AUTH')await base.auth.retire(base.session,w.origin,issuedToken);throw error;});
    }
    authPrepare(input:C.Input<'authPrepare'>,base:RepositoryContext){return base.auth.prepare(input,base.browserCookie);}
    authCallback(input:C.Input<'authCallback'>,base:RepositoryContext){return base.auth.callback(input,base.browserCookie);}
    logout(input:C.Input<'logout'>,base:RepositoryContext){return base.auth.logout(base.session,input.origin);}
}
export type Output<K extends C.Operation> = Awaited<ReturnType<RepositoryEngine[K]>>;
