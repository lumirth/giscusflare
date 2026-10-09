import {countKey,type CountTarget} from '../contracts/count.js';
import type {CountObservation} from '../contracts/document.js';
export interface CountState {target:CountTarget;value?:CountObservation;changed:number;stale:boolean;invalidatedAt?:number;effectChanged?:number}
export interface CountChange {target:CountTarget;value?:CountObservation;invalidatedAt?:number}
export const validCountTarget=(value:unknown):value is CountTarget=>{
  const target=value as CountTarget|null,selector=target?.selector,window=target?.window;
  return Boolean(selector&&(selector.kind==='page'?typeof selector.key==='string'&&selector.key.trim():selector.kind==='discussion'&&Number.isSafeInteger(selector.number)&&selector.number>0&&(selector.id===undefined||typeof selector.id==='string'))&&window&&(window.kind==='roots'||window.kind==='replies'&&typeof window.parentId==='string'&&window.parentId));
};
export const validCountObservation=(value:unknown):value is CountObservation=>{
  const observation=value as CountObservation|null;
  return Boolean(observation&&validCountTarget(observation.target)&&Number.isSafeInteger(observation.count)&&observation.count>=0&&Number.isFinite(observation.observedAt)&&observation.observedAt>=0&&Number.isFinite(observation.expiresAt)&&observation.expiresAt>=observation.observedAt&&(observation.discussion===null||observation.discussion&&typeof observation.discussion.id==='string'&&Number.isSafeInteger(observation.discussion.number)&&observation.discussion.number>0));
};
/** Public reading, effects and independent acquisitions share one count fact and age rule. */
export class CountFacts {
  #entries=new Map<string,CountState>();
  revision=0;
  #listeners=new Map<(change:CountChange)=>void,{active:(target:CountTarget)=>boolean;retain:boolean}>();
  state(target:CountTarget):Readonly<CountState> {return this.#state(target);}
  #state(target:CountTarget):CountState {
    const key=countKey(target);let state=this.#entries.get(key);
    if(!state)this.#entries.set(key,state={target:Object.freeze({selector:Object.freeze({...target.selector}),window:Object.freeze({...target.window})}),changed:0,stale:false});
    return state;
  }
  get(target:CountTarget):CountObservation|null {return this.#entries.get(countKey(target))?.value??null;}
  subscribe(listener:(change:CountChange)=>void,active:(target:CountTarget)=>boolean=()=>true,retain=true):()=>void {
    this.#listeners.set(listener,{active,retain});
    for(const state of this.#entries.values())if(state.value&&active(state.target))this.#deliver(listener,{target:state.target,value:state.value});
    return()=>{this.#listeners.delete(listener);};
  }
  #deliver(listener:(change:CountChange)=>void,change:CountChange):void {
    try{listener(change);}catch(error){console.error('A count subscriber failed.',error);}
  }
  #emit(change:CountChange):void {
    for(const [listener,{active}] of this.#listeners)if(active(change.target))this.#deliver(listener,change);
  }
  observe(value:CountObservation,context:{after?:number;fresh?:boolean;replayed?:boolean;restored?:boolean;effect?:boolean}={}):boolean {
    if(!validCountObservation(value))return false;
    const state=this.#state(value.target),previous=state.value;
    const equalValue=previous&&previous.count===value.count&&previous.discussion?.id===value.discussion?.id&&previous.discussion?.number===value.discussion?.number;
    if(context.effect&&!context.replayed&&equalValue)state.changed=state.effectChanged=++this.revision;
    if(!context.replayed&&context.after!==undefined&&previous&&!equalValue&&(context.effect?state.changed>context.after&&previous.observedAt>=value.observedAt:(state.effectChanged??0)>context.after&&value.observedAt>=previous.observedAt)){
      this.invalidate({target:value.target,observedAt:Math.max(previous.observedAt,value.observedAt)});if(context.effect)state.effectChanged=state.changed;return false;
    }
    if(value.observedAt<(state.invalidatedAt??0)||previous&&previous.observedAt>value.observedAt)return false;
    const same=previous&&previous.observedAt===value.observedAt&&previous.expiresAt===value.expiresAt&&previous.count===value.count&&previous.discussion?.id===value.discussion?.id&&previous.discussion?.number===value.discussion?.number;
    const conflict=previous&&previous.observedAt===value.observedAt&&(previous.count!==value.count||previous.discussion?.id!==value.discussion?.id||previous.discussion?.number!==value.discussion?.number);
    if(previous?.observedAt===value.observedAt&&(context.replayed||context.fresh===false)){if(conflict&&!state.stale)this.invalidate({target:value.target,observedAt:value.observedAt});return false;}
    if(context.restored&&state.stale&&value.observedAt<=(state.invalidatedAt??0)||context.after!==undefined&&state.changed>context.after&&(state.stale||previous?.observedAt===value.observedAt&&!same)||same&&!state.stale)return false;
    state.value=same?previous:Object.freeze({target:state.target,count:value.count,observedAt:value.observedAt,expiresAt:value.expiresAt,discussion:value.discussion&&Object.freeze({id:value.discussion.id,number:value.discussion.number})});
    state.stale=false;state.changed=++this.revision;
    if(context.effect&&!context.replayed)state.effectChanged=state.changed;
    const key=countKey(value.target);this.#entries.delete(key);this.#entries.set(key,state);
    this.#emit({target:state.target,value:state.value});return true;
  }
  invalidate({target,observedAt}:{target:CountTarget;observedAt:number},emit=true):boolean {
    const state=this.#state(target);
    if(!Number.isFinite(observedAt)||observedAt<0||(state.value?.observedAt??0)>observedAt||(state.invalidatedAt??0)>observedAt||!emit&&state.stale&&state.invalidatedAt===observedAt)return false;
    state.invalidatedAt=observedAt;state.stale=true;state.changed=++this.revision;
    const key=countKey(target);this.#entries.delete(key);this.#entries.set(key,state);
    if(emit)this.#emit({target:state.target,invalidatedAt:observedAt});return true;
  }
  restore(records:unknown,oldest:number):void {
    if(!Array.isArray(records))return;
    for(const value of records)if(validCountObservation(value)){if(value.observedAt>oldest)this.observe(value,{restored:true,fresh:false});}
    else if(validCountTarget(value?.target)&&Number.isFinite(value.invalidatedAt)&&value.invalidatedAt>oldest)this.invalidate({target:value.target,observedAt:value.invalidatedAt},false);
  }
  records(maximum:number):unknown[] {
    return [...this.#entries.values()].flatMap<unknown>(state=>state.stale&&state.invalidatedAt!==undefined?[{target:state.target,invalidatedAt:state.invalidatedAt}]:state.value?[state.value]:[]).slice(-maximum);
  }
  targets():CountTarget[] {
    return [...this.#entries.values()].filter(state=>[...this.#listeners.values()].some(({active,retain})=>retain&&active(state.target))).map(state=>state.target);
  }
  clear():void {this.#entries.clear();this.#listeners.clear();}
  prune(oldest:number,maximum:number,pending:(target:CountTarget)=>boolean):void {
    for(const [key,state] of this.#entries)if(!pending(state.target)&&![...this.#listeners.values()].some(({active,retain})=>retain&&active(state.target))&&(this.#entries.size>maximum||((state.stale?state.invalidatedAt:state.value?.observedAt)??0)<oldest))this.#entries.delete(key);
  }
}
