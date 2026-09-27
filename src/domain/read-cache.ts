/** Bounded response reuse within one repository object. Expiry starts before
 * upstream work, so moving a response to another cache cannot extend its life. */
export class ReadCache {
  #entries = new Map<string, { text:string; expires:number; bytes:number }>();
  #pending = new Map<string, Promise<{text:string;expires:number}>>();
  #bytes = 0;
  #revision = 0;
  constructor(readonly now:()=>number=Date.now,readonly maximumBytes=8*1024*1024){}
  invalidate():void{this.#revision++;this.#entries.clear();this.#bytes=0;this.#pending.clear();}
  async response(key:string,ttl:number,read:()=>Promise<unknown>):Promise<Response>{
    const cached=this.#entries.get(key);
    if(cached&&cached.expires>this.now())return this.#response(cached);
    if(cached){this.#entries.delete(key);this.#bytes-=cached.bytes;}
    let pending=this.#pending.get(key);
    if(!pending){
      const revision=this.#revision,expires=this.now()+ttl;
      pending=(async()=>{
        const text=JSON.stringify(await read());
        // JS strings occupy up to two bytes per code unit. Bound retained heap,
        // rather than counting only ASCII network bytes.
        const bytes=text.length*2;
        if(ttl>0&&expires>this.now()&&revision===this.#revision&&bytes<=this.maximumBytes){
          while(this.#bytes+bytes>this.maximumBytes){const oldest=this.#entries.entries().next().value!;this.#bytes-=oldest[1].bytes;this.#entries.delete(oldest[0]);}
          this.#entries.set(key,{text,expires,bytes});this.#bytes+=bytes;
        }
        return {text,expires};
      })();
      this.#pending.set(key,pending);
    }
    try{return this.#response(await pending);}
    finally{if(this.#pending.get(key)===pending)this.#pending.delete(key);}
  }
  #response(value:{text:string;expires:number}):Response{
    const remaining=Math.max(0,Math.floor((value.expires-this.now())/1000));
    return new Response(value.text,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':remaining?'public, max-age='+remaining:'no-store','X-Giscusflare-Expires':String(value.expires)}});
  }
}
