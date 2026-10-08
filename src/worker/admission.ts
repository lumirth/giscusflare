import {installedRepository} from '../domain/github.js';
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
  requireCondition(registry.pending.size < 64, 503, 'RATE_LIMIT', 'Repository validation is busy. Try again shortly.');
  const current=registry;
  const work=(async()=>{
    const started=Date.now();
    try{
      const id=await installedRepository(repo,configuration(env),secrets(env));
      if(current.entries.size>=512)current.entries.delete(current.entries.keys().next().value!);
      current.entries.set(repo,{id,expires:started+60000});return id;
    }catch(error){
      if(error instanceof AppError&&error.status===404)error=new AppError(403,'PERMISSION','Install this service’s GitHub App on the public discussion repository.');
      if(error instanceof AppError&&error.status===403){if(current.entries.size>=512)current.entries.delete(current.entries.keys().next().value!);current.entries.set(repo,{id:null,expires:started+30000});}
      throw error;
    }
  })();
  current.pending.set(repo,work);
  try{return await work;}finally{if(current.pending.get(repo)===work)current.pending.delete(repo);}
}
