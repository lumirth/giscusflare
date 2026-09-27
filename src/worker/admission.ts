import {limitedText} from '../domain/github.js';
import {appJWT} from '../domain/crypto.js';
import {AppError,requireCondition} from '../domain/errors.js';
import {configuration,secrets,type ConfigBindings} from '../contracts/config.js';
interface Entry{expires:number;id:string|null}
const registries=new WeakMap<object,{entries:Map<string,Entry>;pending:Map<string,Promise<string>>}>();
/** Resolve installed public repositories before allocating durable state.
 * Both calls use App authentication, avoiding the shared unauthenticated quota. */
export async function admitRepository(env:ConfigBindings,repo:string):Promise<string>{
  let registry=registries.get(env);
  if(!registry){registry={entries:new Map(),pending:new Map()};registries.set(env,registry);}
  const old=registry.entries.get(repo);
  if(old&&old.expires>Date.now()){
    requireCondition(old.id,403,'PERMISSION','Install this service’s GitHub App on the public discussion repository.');return old.id;
  }
  const pending=registry.pending.get(repo);if(pending)return pending;
  const current=registry;
  const work=(async()=>{
    const config=configuration(env),key=secrets(env),started=Date.now();
    const jwt=await appJWT(config.appId,key.privateKey,started);
    const read=async(path:string,body?:unknown)=>{
      const response=await fetch('https://api.github.com'+path,{headers:{Accept:'application/vnd.github+json','User-Agent':'giscusflare/1','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+jwt,'Content-Type':'application/json'},method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!response.ok){await response.body?.cancel();if([403,404].includes(response.status))throw new AppError(403,'PERMISSION','Install this service’s GitHub App on the public discussion repository.');throw new AppError(503,'UPSTREAM','GitHub repository validation is temporarily unavailable.');}
      const text=await limitedText(response,262144);
      try{return JSON.parse(text) as Record<string,unknown>;}catch{throw new AppError(502,'UPSTREAM_SCHEMA','GitHub returned an invalid repository.');}
    };
    try{
      const installation=await read('/repos/'+repo+'/installation');
      requireCondition(Number.isSafeInteger(installation.id),502,'UPSTREAM_SCHEMA','GitHub returned an invalid installation.');
      const admitted=await read('/app/installations/'+installation.id+'/access_tokens',{repositories:[repo.split('/')[1]],permissions:{metadata:'read'}});
      const repositories=admitted.repositories;
      requireCondition(Array.isArray(repositories)&&repositories.length===1&&repositories[0]&&typeof repositories[0]==='object',502,'UPSTREAM_SCHEMA','GitHub did not identify the installed repository.');
      const publicRepo=repositories[0] as Record<string,unknown>;
      requireCondition(publicRepo.private===false&&typeof publicRepo.node_id==='string'&&/^[A-Za-z0-9_=-]{1,200}$/.test(publicRepo.node_id)&&typeof publicRepo.full_name==='string'&&publicRepo.full_name.toLowerCase()===repo&&Number.isSafeInteger(installation.id),403,'PUBLIC_ONLY','Use the canonical name of a public repository with this GitHub App installed.');
      if(current.entries.size>=512)current.entries.delete(current.entries.keys().next().value!);
      current.entries.set(repo,{id:publicRepo.node_id,expires:started+60000});return publicRepo.node_id;
    }catch(error){
      if(error instanceof AppError&&error.status===403){if(current.entries.size>=512)current.entries.delete(current.entries.keys().next().value!);current.entries.set(repo,{id:null,expires:started+30000});}
      throw error;
    }
  })();
  current.pending.set(repo,work);
  try{return await work;}finally{if(current.pending.get(repo)===work)current.pending.delete(repo);}
}
