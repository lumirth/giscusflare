import {DurableObject} from 'cloudflare:workers';
import {RepositoryEngine,type Registration} from '../domain/repository.js';
import {Store} from '../domain/store.js';
import type * as C from '../contracts/rpc.js';
import type {Env} from './types.js';
/** The established immutable repository object owns coordination, not interpretation. */
export class Repository extends DurableObject<Env>{
  #engine:RepositoryEngine;#store:Store;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);const transactionSync=<T>(action:()=>T)=>ctx.storage.transactionSync(action);this.#store=new Store(ctx.storage.sql,Date.now,transactionSync);this.#engine=new RepositoryEngine(env,this.#store,{sql:ctx.storage.sql,transactionSync});}
  async execute<K extends C.Operation>(operation:K,input:C.Input<K>,registration:Registration,authority:C.Authority={}){const output=await this.#engine.execute(operation,input,registration,authority);this.ctx.waitUntil(Promise.resolve().then(()=>this.#store.schedule(this.ctx,this.#engine.rankingAlarm())).catch(error=>console.error('Repository alarm maintenance failed.',error)));return output;}
  override async alarm(){this.#store.prune();await this.#engine.continueRanking();await this.#store.schedule(this.ctx,this.#engine.rankingAlarm());}
}
