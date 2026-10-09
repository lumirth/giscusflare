import type {CountObservation} from './document.js';
import type {Selector} from './requests.js';
/** Identity of one provider count, independent of request order and rendering. */
export interface CountTarget {
  selector:Selector;
  window:{kind:'roots'}|{kind:'replies';parentId:string};
}
export function countKey(target:CountTarget):string {
  const selector=target.selector,window=target.window;
  return JSON.stringify([selector.kind,selector.kind==='page'?selector.key:selector.number,selector.kind==='discussion'?selector.id??null:null,window.kind,window.kind==='replies'?window.parentId:null]);
}

export function countObservation(target:CountTarget,count:number,discussion:{id:string;number:number}|null,observedAt:number,ttl:number):CountObservation {
  return {target,count,discussion,observedAt,expiresAt:observedAt+ttl};
}
