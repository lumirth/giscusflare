import { readResponse } from './read-response.js';
import type { SerializedRead } from '../contracts/rpc.js';
import type { Context } from 'hono';
import type { AppEnv } from './types.js';
import { configuration } from '../contracts/config.js';
import { authorizeWidget, parentOrigin, policy } from '../domain/authorization.js';
import { hash } from '../domain/crypto.js';
import type { Selection } from '../contracts/requests.js';

const policyKeys=new WeakMap<object,Promise<string>>();
function policyKey(config:object):Promise<string>{
  let key=policyKeys.get(config);if(!key){key=hash(JSON.stringify(config));policyKeys.set(config,key);}return key;
}

/** Authorization from current deployment settings always precedes edge reuse.
 * Remote GitHub changes become visible when the original response expires. */
export async function publicRead(c:Context<AppEnv>, input:{repo:string;origin:string}|{config:Selection},read:()=>Promise<SerializedRead>):Promise<Response>{
  const config=configuration(c.env);
  if('config' in input)authorizeWidget(config,input.config);
  else parentOrigin(policy(config,input.repo),input.origin);
  if(c.get('session'))return readResponse(await read());
  const cache=typeof caches==='undefined'?null:caches.default;
  if(!cache)return readResponse(await read());
  const url=new URL(c.req.url);
  // Changed deployment policy cannot reuse entries admitted by an old policy.
  if(url.pathname.startsWith('/api/')){
    const payload=JSON.parse(url.searchParams.get('input')||'{}');
    if(payload.config)payload.config.origin=new URL(payload.config.origin).origin;
    else if(payload.origin)payload.origin=new URL(payload.origin).origin;
    if(payload.terms)payload.terms=[...new Set(payload.terms)].sort();
    url.searchParams.set('input',JSON.stringify(payload));
  }
  url.searchParams.set('policy',await policyKey(config));
  const key=new Request(url,{method:'GET'});
  const found=await cache.match(key);
  if(found&&Number(found.headers.get('X-Giscusflare-Expires'))>Date.now())return found;
  const response=readResponse(await read());
  if(response.ok&&Number(response.headers.get('X-Giscusflare-Expires'))>Date.now()&&response.headers.get('Cache-Control')?.startsWith('public,')){
    c.executionCtx.waitUntil(cache.put(key,response.clone()).catch(()=>undefined));
  }
  return response;
}
