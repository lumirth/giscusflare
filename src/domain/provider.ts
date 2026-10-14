import * as v from 'valibot';
import { AppError, requireCondition, result, unwrap, type Result } from './errors.js';
import {hash} from './crypto.js';
import {OAuthToken} from '../contracts/github.js';
import {Creation} from '../contracts/storage.js';
import type { Store } from './store.js';
const Deadline = v.strictObject({ until: v.number(),unavailable:v.optional(v.boolean()) });
export interface ProviderPermit { id: string; resource: string }
export interface ProviderFeedback { retryAfter?: number; remaining?: number; reset?: number; secondary?: boolean;unavailable?:boolean;requestId?:string }
export interface Renewal {token:v.InferOutput<typeof OAuthToken>;observedAt:number}
export interface ProviderCoordination {
  renew(refreshToken:string,requestId?:string):Promise<Result<Renewal>>;
  begin(scope: string, resource: string,priority?:'interactive'|'background'): Promise<Result<ProviderPermit>>;
  finish(scope: string, permit: ProviderPermit, feedback: ProviderFeedback): Promise<void>;
}
/** Allowance-scoped admission contains pressure; it never chooses another credential. */
export class ProviderGate {
  constructor(readonly store: Store) {}
  renew(refreshToken:string,secret:string,purpose:string,exchange:(token:string)=>Promise<v.InferOutput<typeof OAuthToken>>):Promise<Result<Renewal>>{
    return result(async()=>{
      const origin='renewal:'+await hash(refreshToken);
      return this.store.lock(origin,async()=>{
        let token=refreshToken;
        const schema=v.strictObject({token:OAuthToken,observedAt:v.number()});
        for(let step=0;step<100;step++){
          const key='renewal:'+await hash(token),pending=key+':pending';
          const prior=await this.store.secret(key,schema,secret,purpose);
          if(prior){if(prior.observedAt+(prior.token.expires_in??28800)*1000>this.store.now()+60000)return prior;requireCondition(prior.token.refresh_token,401,'GITHUB_AUTH','GitHub authorization needs reconnecting.');token=prior.token.refresh_token;continue;}
          return this.store.lock(pending,async()=>{
            const ready=await this.store.secret(key,schema,secret,purpose);if(ready)return ready;
            if(this.store.get(pending,Creation))throw new AppError(401,'GITHUB_AUTH','The authorization renewal outcome could not be recovered. Reconnect GitHub.');
            this.store.put(pending,Creation,{started:this.store.now()},this.store.now()+30*86400000);
            try{
              const observedAt=this.store.now(),next=await exchange(token);
              requireCondition(next.refresh_token&&next.refresh_token_expires_in,502,'UPSTREAM_SCHEMA','GitHub did not return complete rotating credentials.');
              const renewed={token:next,observedAt};
              await this.store.putSecret(key,schema,renewed,secret,purpose,this.store.now()+(next.refresh_token_expires_in??15552000)*1000);
              this.store.delete(pending);return renewed;
            }catch(error){if(error instanceof AppError&&error.phase==='not-issued'&&[400,401,403,429,503].includes(error.status))this.store.delete(pending);throw error;}
          });
        }
        throw new AppError(401,'GITHUB_AUTH','The authorization renewal history expired. Reconnect GitHub.');
      });
    });
  }
  begin(resource: string,priority:'interactive'|'background'='interactive'): Promise<Result<ProviderPermit>> {
    return result(async () => {
      const now = this.store.now();
      const shared=this.store.get('cooldown:all',Deadline),local=this.store.get('cooldown:'+resource,Deadline);
      const cooldown=(shared?.until??0)>=(local?.until??0)?shared:local,until=cooldown?.until??0;
      if(until>now){
        const retryAfter=Math.ceil((until-now)/1000);
        if(cooldown?.unavailable)throw new AppError(503,'UPSTREAM','GitHub is temporarily unavailable. Try again later.',retryAfter);
        throw new AppError(429,'RATE_LIMIT','GitHub is limiting requests. Try again later.',retryAfter,'not-issued',(shared?.until??0)>now?'secondary':'primary');
      }
      this.store.sql.exec('CREATE TABLE IF NOT EXISTS provider_permits (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
      this.store.sql.exec('DELETE FROM provider_permits WHERE expires<=?', now);
      const active = Number([...this.store.sql.exec('SELECT COUNT(*) AS count FROM provider_permits')][0]?.count ?? 0);
      if(priority==='background'&&active>=2)throw new AppError(429,'RANKING_BUDGET','Background acquisition is waiting for interactive requests.',2);
      if (active >= 8) throw new AppError(503, 'UPSTREAM', 'GitHub requests are busy. Try again shortly.', 2);
      const id = crypto.randomUUID();
      this.store.sql.exec('INSERT INTO provider_permits VALUES(?,?)', id, now + 30000);
      return { id, resource };
    });
  }
  async finish(permit: ProviderPermit, feedback: ProviderFeedback): Promise<void> {
    this.store.sql.exec('DELETE FROM provider_permits WHERE id=?', permit.id);
    const now = this.store.now(), until = feedback.retryAfter ? now + feedback.retryAfter * 1000 : feedback.remaining === 0 && feedback.reset ? feedback.reset : 0;
    if (until > now) {
      const key = 'cooldown:' + (feedback.secondary ? 'all' : permit.resource);
      const previous=this.store.get(key,Deadline),cooldown=previous&&previous.until>=until?previous:{until,unavailable:Boolean(feedback.unavailable)};
      this.store.put(key,Deadline,cooldown,cooldown.until);
      console.warn(JSON.stringify({event:'provider_cooldown',requestId:feedback.requestId,resource:permit.resource,secondary:Boolean(feedback.secondary),unavailable:Boolean(cooldown.unavailable),until:cooldown.until}));
    }
  }
}
export async function admitted<T>(coordination: ProviderCoordination, scope: string, resource: string, action: (feedback: ProviderFeedback) => Promise<T>,priority:'interactive'|'background'='interactive',requestId?:string): Promise<T> {
  const admission=await coordination.begin(scope,resource,priority);
  if(!admission.ok)console.info(JSON.stringify({event:'provider_admission',requestId,authority:scope.split(':')[0],resource,outcome:'deferred',code:admission.error.code,retryAfter:admission.error.retryAfter}));
  const permit = unwrap(admission), feedback: ProviderFeedback = {requestId};
  try { return await action(feedback); }
  finally {
    try { await coordination.finish(scope, permit, feedback); }
    catch { console.error(JSON.stringify({ event: 'provider_feedback_failed', scope, resource })); }
  }
}
