/** Retained-memory bound, including mutable values when they are reinserted. */
export class LRU<T> {
  #items=new Map<string,{value:T;bytes:number}>();
  #bytes=0;
  constructor(readonly maximumBytes:number,readonly maximumItems=Infinity){}
  get(key:string):T|undefined{
    const item=this.#items.get(key);if(!item)return;
    this.#items.delete(key);this.#items.set(key,item);return item.value;
  }
  set(key:string,value:T,bytes:number):void{
    const old=this.#items.get(key);if(old){this.#items.delete(key);this.#bytes-=old.bytes;}
    if(bytes>this.maximumBytes)return;
    while(this.#bytes+bytes>this.maximumBytes||this.#items.size>=this.maximumItems){const [key,item]=this.#items.entries().next().value!;this.#items.delete(key);this.#bytes-=item.bytes;}
    this.#items.set(key,{value,bytes});this.#bytes+=bytes;
  }
  clear():void{this.#items.clear();this.#bytes=0;}
}
