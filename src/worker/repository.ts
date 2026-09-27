import { DurableObject } from 'cloudflare:workers';
import { RepositoryEngine } from '../domain/repository.js';
import { Store } from '../domain/store.js';
import { configuration } from '../contracts/config.js';
import { policy } from '../domain/authorization.js';
import { ReadCache } from '../domain/read-cache.js';
import { serializeRead } from './read-response.js';
import { json, widgetHTML } from './html.js';
import { result, failure, type Result } from '../domain/errors.js';
import type { DurableState, FetchLike } from '../domain/platform.js';
import type * as C from '../contracts/rpc.js';
import type * as R from '../contracts/requests.js';
import type { Env } from './types.js';

/** The native tests provide their GitHub transport here. */
export function repositoryClass(transport?: FetchLike) {
  return class RepositoryObject extends DurableObject<Env> {
    #cache=new ReadCache();
    #env:Env;
    #engine: RepositoryEngine;
    #store: Store;
    #state: DurableState;
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env); this.#env=env; this.#state = ctx; this.#store = new Store(ctx.storage.sql);
      this.#engine = new RepositoryEngine(env,this.#store,transport,{sql:ctx.storage.sql,transactionSync:fn=>ctx.storage.transactionSync(fn)});
    }
    async #scheduleRanking():Promise<void>{
      const next=this.#engine.rankingAlarm();if(next===null)return;
      const existing=await this.#state.storage.getAlarm();if(!existing||existing>next)await this.#state.storage.setAlarm(next);
    }
    async #call<T>(run: () => Promise<T>): Promise<Result<T>> {
      const output = await result(run);
      try { await this.#store.schedule(this.#state); }
      catch { console.error('giscus: expiry alarm could not be scheduled'); }
      return output;
    }
    async #read(key:string,repo:string,session:string,kind:'display'|'count',run:()=>Promise<unknown>):Promise<Response>{
      try{
        if(session)return json(await run());
        const p=policy(configuration(this.#env),repo);
        return await this.#cache.response(key,kind==='count'?p.countCacheMs:p.displayCacheMs,run);
      }catch(error){const e=failure(error);return json({error:e},e.status,e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});}
      finally{await this.#store.schedule(this.#state);}
    }
    async counts(input:R.CountsRequest){return serializeRead(await this.#read('counts:'+JSON.stringify(input),input.repo,'','count',()=>this.#engine.counts(input)));}
    async info(input:R.InfoRequest){return serializeRead(await this.#read('info:'+JSON.stringify(input),input.repo,'','display',()=>this.#engine.info(input)));}
    #threadResponse(input:C.ThreadCall){return this.#read('thread:'+JSON.stringify(input.request),input.request.config.repo,input.session,'display',()=>this.#engine.thread(input));}
    async thread(input:C.ThreadCall){return serializeRead(await this.#threadResponse(input));}
    async replies(input:C.RepliesCall){return serializeRead(await this.#read('replies:'+JSON.stringify(input.request),input.request.config.repo,input.session,'display',()=>this.#engine.replies(input)));}
    async widget(input:C.ThreadCall):Promise<C.SerializedRead>{
      const response=await this.#threadResponse({...input,session:''});
      if(!response.ok)return serializeRead(response);
      const bootstrap={view:await response.json(),expires:Number(response.headers.get('X-Giscusflare-Expires'))};
      const html=widgetHTML(input.request.config,policy(configuration(this.#env),input.request.config.repo),bootstrap);
      html.headers.set('X-Giscusflare-Expires',String(bootstrap.expires));
      html.headers.set('Cache-Control',response.headers.get('Cache-Control')||'no-store');
      return serializeRead(html);
    }
    async ranking(input:C.RankingCall):Promise<C.SerializedRead>{
      try{return serializeRead(json(await this.#engine.ranking(input)));}
      catch(error){const e=failure(error);return serializeRead(json({error:e},e.status));}
      finally{await this.#store.schedule(this.#state);await this.#scheduleRanking();}
    }
    async hydrate(input:C.HydrateCall){return serializeRead(await this.#read('hydrate:'+JSON.stringify(input.request),input.request.config.repo,input.session,'display',()=>this.#engine.hydrate(input)));}
    async #write<T>(run:()=>Promise<T>):Promise<Result<T>>{
      // Invalidate after success or an uncertain result; a read that started
      // before the mutation may not refill the shared cache afterward.
      try{return await this.#call(run);}finally{this.#cache.invalidate();await this.#scheduleRanking();}
    }
    comment(input: C.CommentCall) { return this.#write(() => this.#engine.comment(input)); }
    edit(input: C.EditCall) { return this.#write(() => this.#engine.edit(input)); }
    remove(input: C.DeleteCall) { return this.#write(() => this.#engine.remove(input)); }
    reaction(input: C.ReactionCall) { return this.#write(() => this.#engine.reaction(input)); }
    moderate(input: C.ModerateCall) { return this.#write(() => this.#engine.moderate(input)); }
    preview(input: C.PreviewCall) { return this.#call(() => this.#engine.preview(input)); }
    authPrepare(input: C.PrepareCall) { return this.#call(() => this.#engine.authPrepare(input)); }
    authCallback(input: C.CallbackCall) { return this.#call(() => this.#engine.authCallback(input)); }
    authPoll(input: R.AuthProof) { return this.#call(() => this.#engine.authPoll(input)); }
    authConsume(input: R.AuthConsume) { return this.#call(() => this.#engine.authConsume(input)); }
    logout(input: C.LogoutCall) { return this.#call(() => this.#engine.logout(input)); }
    override async alarm(): Promise<void> { this.#store.prune(); await this.#engine.continueRanking();await this.#store.schedule(this.#state);await this.#scheduleRanking(); }
  };
}
export class Repository extends repositoryClass() {}
