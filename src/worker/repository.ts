import {DurableObject} from 'cloudflare:workers';
import {RepositoryEngine,type Registration} from '../domain/repository.js';
import {configuration,secrets} from '../contracts/config.js';
import {GitHub} from '../domain/github.js';
import {ProviderGate} from '../domain/provider.js';
import type {ProviderPermit,ProviderFeedback} from '../domain/provider.js';
import {Store} from '../domain/store.js';
import type * as C from '../contracts/rpc.js';
import type {Env} from './types.js';
/** The established immutable repository object owns coordination, not interpretation. */
export class Repository extends DurableObject<Env>{
  #engine:RepositoryEngine;#store:Store;#provider:ProviderGate;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);const transactionSync=<T>(action:()=>T)=>ctx.storage.transactionSync(action);this.#store=new Store(ctx.storage.sql,Date.now,transactionSync);this.#provider=new ProviderGate(this.#store);this.#engine=new RepositoryEngine(env,this.#store,{sql:ctx.storage.sql,transactionSync},{renew:async token=>this.#peer('oauth:'+env.GITHUB_CLIENT_ID).providerRenew(token),begin:async(scope,resource)=>this.#peer(scope).providerBegin(resource),finish:async(scope,permit,feedback)=>this.#peer(scope).providerFinish(permit,feedback)},work=>this.ctx.waitUntil(work));}
  #peer(scope:string){return this.env.REPOSITORY_STORE.get(this.env.REPOSITORY_STORE.idFromName('provider:'+this.env.GITHUB_APP_ID+':'+scope));}
  async providerRenew(token:string):Promise<import('../domain/errors.js').Result<import('../domain/provider.js').Renewal>>{
    const config=configuration(this.env),keys=secrets(this.env);
    const client=new GitHub('authorization/renewal','R_authorization',1,'CAT_authorization',config,keys,this.#store,{renew:async value=>this.providerRenew(value),begin:async(scope,resource)=>this.#peer(scope).providerBegin(resource),finish:async(scope,permit,feedback)=>this.#peer(scope).providerFinish(permit,feedback)});
    return this.#provider.renew(token,keys.sessionSecret,'oauth:'+config.appId+':'+config.clientId,value=>client.exchange({grant_type:'refresh_token',refresh_token:value}));
  }
  async providerBegin(resource:string){return this.#provider.begin(resource);}
  async providerFinish(permit:ProviderPermit,feedback:ProviderFeedback){await this.#provider.finish(permit,feedback);}
  async webhook(input:Parameters<RepositoryEngine['webhook']>[0],registration:Registration,repo:string){this.#engine.webhook(input,registration,repo);this.ctx.waitUntil(this.#store.schedule(this.ctx,this.#engine.rankingAlarm()));}
  async execute<K extends C.Operation>(operation:K,input:C.Input<K>,registration:Registration,authority:C.Authority={}){const output=await this.#engine.execute(operation,input,registration,authority);this.ctx.waitUntil(Promise.resolve().then(()=>this.#store.schedule(this.ctx,this.#engine.rankingAlarm())).catch(error=>console.error('Repository alarm maintenance failed.',error)));return output;}
  override async alarm(){this.#store.prune();await this.#engine.continueRanking();await this.#store.schedule(this.ctx,this.#engine.rankingAlarm());}
}
