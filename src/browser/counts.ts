import type {CountObservation} from '../contracts/document.js';
import {CountFacts,validCountObservation} from '../conversation/counts.js';
import {batchRequests,type BatchRequest} from './batch.js';
import {requestJSON,validateService} from './http.js';
import {countKey,type CountTarget} from '../contracts/count.js';
export {countKey,type CountTarget} from '../contracts/count.js';
export {CountFacts} from '../conversation/counts.js';
export type {CountObservation} from '../contracts/document.js';
export interface CountsOptions {
  service:string;repo:string;origin:string;registration?:string;
  /** Optional same-tab retention. Null disables storage. */
  storage?:Storage|null;
}
export interface Counts {
  readonly facts:CountFacts;
  subscribe(target:string|CountTarget,listener:(observation:CountObservation)=>void):()=>void;
  read(targets:readonly(string|CountTarget)[],signal?:AbortSignal):Promise<void>;
  observe(observation:CountObservation):void;
  invalidate(value:{target:CountTarget;observedAt:number}):Promise<CountObservation|undefined>;
  dispose():void;
}
type Acquisition={target:CountTarget;after:number;fresh:boolean;job?:Request};
type Request=BatchRequest<Acquisition,void>;
const retention=3_600_000,maximum=200,registries=new Set<Registry>();
const selected=(target:string|CountTarget):CountTarget=>typeof target==='string'?{selector:{kind:'page',key:target},window:{kind:'roots'}}:target;
/** Browser acquisition and retention use the same portable facts as the mounted page. */
class Registry {
  readonly facts=new CountFacts();
  readonly lifetime=new AbortController();
  readonly requests=new Map<string,Request>();
  readonly acquire=batchRequests<Acquisition,void>({group:input=>input.fresh,run:(inputs,signal)=>this.fetch(inputs,signal)});
  users=0;
  #snapshot:string|null=null;
  #restoring=false;
  constructor(readonly options:CountsOptions,readonly identity:string,readonly storage:Storage|null){
    this.facts.subscribe(change=>{
      if(!this.#restoring||change.invalidatedAt!==undefined)this.save();
      if(change.invalidatedAt!==undefined)void this.read([change.target],this.lifetime.signal).catch(()=>{});
      else{const request=this.requests.get(countKey(change.target));if(request&&!request.dispatched)request.finish({value:undefined});}
    },()=>true,false);
    if(typeof window!=='undefined')window.addEventListener('pageshow',event=>{if(event.persisted){this.restore();void this.read(this.facts.targets(),this.lifetime.signal).catch(()=>{});}},{signal:this.lifetime.signal});
    this.restore();
  }
  restore():void {try{const raw=this.storage?.getItem('giscusflare:counts:'+this.identity)??null;if(raw!==this.#snapshot){this.#snapshot=raw;this.#restoring=true;this.facts.restore(JSON.parse(raw||'[]'),Date.now()-retention);}}catch{/* Optional retention. */}finally{this.#restoring=false;}}
  save():void {if(this.storage)try{this.#snapshot=JSON.stringify(this.facts.records(maximum));this.storage.setItem('giscusflare:counts:'+this.identity,this.#snapshot);}catch{/* Facts remain available without storage. */}}
  prune():void {this.facts.prune(Date.now()-retention,maximum,target=>this.requests.has(countKey(target)));}
  release():void {if(--this.users)return;registries.delete(this);this.lifetime.abort();this.requests.clear();this.facts.clear();}
  async read(targets:readonly CountTarget[],signal:AbortSignal):Promise<void>{
    this.restore();signal.throwIfAborted();
    await Promise.all(targets.map(async target=>{
      const state=this.facts.state(target),key=countKey(target);
      if(!state.stale&&state.value&&state.value.expiresAt>Date.now()&&Date.now()-state.value.observedAt<retention)return;
      let request=this.requests.get(key);
      if(!request||request.input.after!==state.changed){request=this.acquire(JSON.stringify([key,state.changed,state.stale]),{target:state.target,after:state.changed,fresh:state.stale||Boolean(state.value)});request.input.job=request;this.requests.set(key,request);}
      try{await request.wait(signal);}finally{if(this.requests.get(key)===request)this.requests.delete(key);this.prune();}
    }));
  }
  async fetch(batch:Acquisition[],signal:AbortSignal){
    const {service,repo,origin,registration}=this.options;
    const data=await requestJSON<{observations?:Record<string,unknown>;errors?:Record<string,{message?:string}>}>(service,'counts',{repo,origin,targets:batch.map(item=>item.target),...(registration?{registration}:{}),...(batch[0]!.fresh?{fresh:true}:{})},{method:'GET',postFallback:true,signal});
    signal.throwIfAborted();
    return batch.map(({target,after,fresh,job})=>{
      if(!job?.active)return{value:undefined};
      const key=countKey(target),value=data.observations?.[key];
      if(!validCountObservation(value)||countKey(value.target)!==key)return{error:new Error(data.errors?.[key]?.message||'The comments service returned an invalid count observation.')};
      this.facts.observe(value,{after,fresh});return{value:undefined};
    });
  }
}
/** Shared handles carry one fact owner and release work with their actual consumer lifetimes. */
export function createCounts(options:CountsOptions):Counts {
  validateService(options.service);
  if(new URL(options.origin).origin!==options.origin)throw new TypeError('Counts need a website origin.');
  let storage:Storage|null;try{storage=options.storage===undefined?globalThis.sessionStorage??null:options.storage;}catch{storage=null;}
  const identity=JSON.stringify([options.service,options.repo,options.origin,options.registration??null]);
  const registry=[...registries].find(value=>value.identity===identity&&value.storage===storage)||new Registry({...options},identity,storage);
  registries.add(registry);registry.users++;
  const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,registry.lifetime.signal]),subscriptions=new Set<()=>void>();
  return{
    facts:registry.facts,
    subscribe(target,listener){
      signal.throwIfAborted();const item=selected(target),key=countKey(item),consumer=new AbortController();
      const stop=registry.facts.subscribe(change=>{if(change.value)listener(change.value);},value=>countKey(value)===key);
      const release=()=>{stop();consumer.abort();subscriptions.delete(release);registry.prune();};subscriptions.add(release);
      void registry.read([item],AbortSignal.any([signal,consumer.signal])).catch(()=>{});return release;
    },
    read(targets,cancel){return registry.read(targets.map(selected),cancel?AbortSignal.any([signal,cancel]):signal);},
    observe(value){if(!signal.aborted)registry.facts.observe(value);},
    async invalidate(value){signal.throwIfAborted();if(registry.facts.invalidate(value))await registry.read([value.target],signal);return registry.facts.get(value.target)??undefined;},
    dispose(){if(lifetime.signal.aborted)return;lifetime.abort();for(const release of subscriptions)release();registry.release();},
  };
}
