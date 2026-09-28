interface Entry { text: string; expires: number; bytes: number; group: string }
/** Repository-owned, byte-bounded LRU. Pending work is shared, never persisted. */
export class ReadCache {
  #entries = new Map<string, Entry>();
  #pending = new Map<string, { group: string; promise: Promise<Entry> }>();
  #bytes = 0;
  constructor(readonly now:()=>number=Date.now,readonly maximumBytes=8*1024*1024){}
  invalidate(matches: (group:string)=>boolean): void {
    for(const [key,entry] of this.#entries) if(matches(entry.group)){this.#entries.delete(key);this.#bytes-=entry.bytes;}
    for(const [key,entry] of this.#pending) if(matches(entry.group)) this.#pending.delete(key);
  }
  async read(key:string,group:string,ttl:number,read:()=>Promise<unknown>):Promise<Entry>{
    const cached=this.#entries.get(key);
    if(cached&&cached.expires>this.now()){
      this.#entries.delete(key);this.#entries.set(key,cached);return cached;
    }
    if(cached){this.#entries.delete(key);this.#bytes-=cached.bytes;}
    let pending=this.#pending.get(key);
    if(!pending){
      const expires=this.now()+ttl;
      const promise=Promise.resolve().then(read).then(value=>{
        const text=JSON.stringify(value),bytes=(text.length+key.length+group.length)*2+128;
        const result={text,expires,bytes,group};
        if(this.#pending.get(key)===entry&&ttl>0&&expires>this.now()&&bytes<=this.maximumBytes){
          while(this.#bytes+bytes>this.maximumBytes){const oldest=this.#entries.entries().next().value!;this.#bytes-=oldest[1].bytes;this.#entries.delete(oldest[0]);}
          this.#entries.set(key,result);this.#bytes+=bytes;
        }
        return result;
      }).finally(()=>{if(this.#pending.get(key)===entry)this.#pending.delete(key);});
      const entry={group,promise};
      this.#pending.set(key,entry);
      pending=entry;
    }
    return pending.promise;
  }
  async response(key:string,group:string,ttl:number,read:()=>Promise<unknown>):Promise<Response>{
    return readResponse(await this.read(key,group,ttl,read),this.now());
  }
}
export function readResponse(value:{text:string;expires:number},now=Date.now()):Response{
  const remaining=Math.max(0,Math.floor((value.expires-now)/1000));
  return new Response(value.text,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':remaining?'public, max-age='+remaining:'no-store','X-Giscusflare-Expires':String(value.expires)}});
}
