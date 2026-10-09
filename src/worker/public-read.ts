import type { ReadValue } from '../contracts/results.js';
import { json } from './html.js';
import type { Context } from 'hono';
import type { AppEnv } from './types.js';
import { configuration } from '../contracts/config.js';
import { authorizeWidget, parentOrigin, policy } from '../domain/authorization.js';
import { hash } from '../domain/crypto.js';
import {countKey} from '../contracts/count.js';
import type {Selection} from '../contracts/requests.js';

const policyKeys=new WeakMap<object,Promise<string>>();
function policyKey(config:object):Promise<string>{
  let key=policyKeys.get(config);if(!key){key=hash(JSON.stringify(config));policyKeys.set(config,key);}return key;
}

/** Authorization from current deployment settings always precedes edge reuse.
 * Remote GitHub changes become visible when the original response expires. */
export async function publicRead(c:Context<AppEnv>, input:{repo:string;origin:string}|{config:Selection},read:()=>Promise<ReadValue<unknown>>,render:(value:unknown,expires:number)=>Response=value=>json(value)):Promise<Response>{
  const config=configuration(c.env);
  if('config' in input)authorizeWidget(config,input.config);
  else parentOrigin(policy(config,input.repo),input.origin);
  const fresh='fresh'in input&&input.fresh===true;
  const respond=async()=>{
    const {value,expires} = await read(), response = render(value,expires);
    const remaining = Math.max(0, Math.floor((expires - Date.now()) / 1000));
    response.headers.set('Cache-Control', remaining?'public, max-age=' + remaining : 'no-store');
    response.headers.set('X-Giscusflare-Expires', String(expires));
    return response;
  };

  if(c.req.method==='POST'||fresh||c.req.header('Cache-Control')?.includes('no-cache'))return respond();
  const cache=typeof caches==='undefined'?null:caches.default;
  if(!cache)return respond();
  const url=new URL(c.req.url);
  // Changed deployment policy cannot reuse entries admitted by an old policy.
  if(url.pathname.startsWith('/api/')){
    const payload=structuredClone(input) as {config?:Selection;origin?:string;targets?:import('../contracts/count.js').CountTarget[]};
    if(payload.config){payload.config.origin=new URL(payload.config.origin).origin;payload.config.pageURL=payload.config.origin+'/';payload.config.returnURL=payload.config.origin+'/';}
    else if(payload.origin)payload.origin=new URL(payload.origin).origin;
    if(payload.targets)payload.targets=[...new Map(payload.targets.map(target=>[countKey(target),target])).values()].sort((a,b)=>countKey(a).localeCompare(countKey(b)));
    url.searchParams.set('input',JSON.stringify(payload));
  }
  url.searchParams.set('policy',await policyKey(config));
  const key=new Request(url,{method:'GET'});
  const found=await cache.match(key);
  if(found&&Number(found.headers.get('X-Giscusflare-Expires'))>Date.now())return new Response(found.body,found);
  const response=await respond();
  if(response.ok&&Number(response.headers.get('X-Giscusflare-Expires'))>Date.now()&&response.headers.get('Cache-Control')?.startsWith('public,')){
    c.executionCtx.waitUntil(cache.put(key,response.clone()).catch(()=>undefined));
  }
  return response;
}
