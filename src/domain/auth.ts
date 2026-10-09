import { parse } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import type * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import {User} from '../contracts/primitives.js';
import type {Viewer,Person} from '../contracts/document.js';
import type { OAuthToken } from '../contracts/github.js';
import type { PublicConfig, RepositoryPolicy, SecretConfig } from '../contracts/config.js';
import { parentOrigin } from './authorization.js';
import { b64, equal, hash, random, unb64 } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import { GitHub } from './github.js';
import { Store } from './store.js';
const DAY = 86400000, TEN_MINUTES = 600000;
export type AuthorizedSession=S.Session&{credentials:NonNullable<S.Session['credentials']>};
export type CallbackResult = { status: 'ready' | 'denied'; attempt: string; repo: string; returnURL: string; mode: 'popup' | 'redirect'; openerOrigin: string };
export function stateValue(repo:string,attempt:string,registration?:string):string{return b64(new TextEncoder().encode(repo))+'.'+attempt+(registration?'.'+b64(new TextEncoder().encode(registration)):'');}
export function stateParts(state:string):R.AuthStartQuery {
  const match=/^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})(?:\.([A-Za-z0-9_-]{1,8192}))?$/.exec(state);
  requireCondition(match?.[1]&&match[2],400,'OAUTH','Invalid authorization state.');
  const decode=(value:string)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(unb64(value));
  return parse(R.AuthStartQuery,{repo:decode(match[1]),attempt:match[2],...(match[3]?{registration:decode(match[3])}:{})});
}
export function cookieName(origin: string, attempt: string): string { return (origin.startsWith('https:') ? '__Host-' : '') + 'gw-auth-' + attempt.slice(0, 16); }
export class Auth {
  #purpose: string;
  constructor(readonly config: PublicConfig, readonly keys: SecretConfig, readonly repo: string, repositoryId: string, readonly policy: RepositoryPolicy, readonly store: Store, readonly github: GitHub) {
    this.#purpose = `${config.appId}:${config.clientId}:${repositoryId}`;
  }
  #fields(data: OAuthToken): NonNullable<S.Session['credentials']> {
    const now = this.store.now();
    return { accessToken: data.access_token, accessExpires: now + (data.expires_in ? data.expires_in * 1000 : 30 * DAY),
      refreshToken: data.refresh_token || null, refreshExpires: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : 0 };
  }
  async prepare(request: C.Input<'authPrepare'>,browserCookie:string): Promise<{ attempt: string; authorizeURL: string }> {
    const origin=request.origin;
    const openerOrigin = request.openerOrigin || this.config.origin;
    requireCondition(openerOrigin === this.config.origin || openerOrigin === origin, 403, 'ORIGIN', 'The sign-in opener must be the service or authorized page.');
    const attempt = await hash(request.proof), githubVerifier = random(), now = this.store.now();
    return this.store.lock('auth:' + attempt, () => this.store.lock('session:' + request.proof, async () => {
    requireCondition(!this.store.get('session:' + request.proof, S.EncryptedRecord), 409, 'OAUTH', 'This session already exists. Start a new sign-in.');
    requireCondition(!this.store.get('auth:' + attempt, S.EncryptedRecord), 409, 'OAUTH', 'This sign-in is already being prepared. Start again.');
    requireCondition(new URL(request.returnURL).origin===origin,403,'ORIGIN','The return URL belongs to another website.');
    const url=new URL(request.returnURL); url.hash = ''; url.searchParams.delete('giscus');
    const record: S.OAuthAttempt = { origin, returnURL: url.toString(), mode: request.mode, openerOrigin,
      sessionID: request.proof, githubVerifier, cookieHash: await hash(browserCookie), created: now, expires: now + TEN_MINUTES,
      status: 'pending' };
    await this.store.putSecret('auth:' + attempt, S.OAuthAttempt, record, this.keys.sessionSecret, this.#purpose, record.expires);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.origin + '/auth/callback', state: stateValue(this.repo,attempt,request.registration), code_challenge: await hash(githubVerifier), code_challenge_method: 'S256' }).toString();
    return { attempt, authorizeURL: authorize.toString() };
    }));
  }
  async #attempt(id: string): Promise<S.OAuthAttempt | null> {
    let attempt: S.OAuthAttempt | null;
    try { attempt = await this.store.secret('auth:' + id, S.OAuthAttempt, this.keys.sessionSecret, this.#purpose); }
    catch { this.store.delete('auth:' + id); throw new AppError(401, 'OAUTH', 'This sign-in attempt is invalid. Start again.'); }
    if (attempt) {
      requireCondition(attempt.expires > this.store.now(), 401, 'OAUTH', 'This sign-in attempt expired. Start again.');
      parentOrigin(this.policy, attempt.origin);
    }
    return attempt;
  }
  async #saveAttempt(id: string, data: S.OAuthAttempt): Promise<void> {
    await this.store.putSecret('auth:' + id, S.OAuthAttempt, data, this.keys.sessionSecret, this.#purpose, data.expires);
  }
  async callback(input: C.Input<'authCallback'>,browserCookie:string): Promise<CallbackResult> {
    return this.store.lock('auth:' + input.attempt, async () => {
      const attempt = await this.#attempt(input.attempt);
      requireCondition(attempt, 401, 'OAUTH', 'This sign-in attempt expired or was already used. Start again.');
      requireCondition(browserCookie && equal(await hash(browserCookie), attempt.cookieHash), 401, 'OAUTH', 'Sign-in must finish in the browser that started it.');
      requireCondition(attempt.status === 'pending', 409, 'OAUTH', 'This sign-in callback was already used.');
      const view = (status: 'ready' | 'denied'): CallbackResult => ({ status, attempt: input.attempt, repo: this.repo, returnURL: attempt.returnURL, mode: attempt.mode, openerOrigin: attempt.openerOrigin || this.config.origin });
      if (input.denied) { this.store.delete('auth:' + input.attempt); return view('denied'); }
      requireCondition(input.code, 400, 'OAUTH', 'GitHub did not return an authorization code.');
      attempt.status = 'exchanging'; await this.#saveAttempt(input.attempt, attempt);
      try {
        const token = await this.github.exchange({ code: input.code, code_verifier: attempt.githubVerifier, redirect_uri: this.config.origin + '/auth/callback' });
        const identity=await this.github.identity(token.access_token),principal=identity.id,fields=this.#fields(token);
        const session = { principal, credentials: fields, origin: attempt.origin,
          expires: Math.min(this.store.now() + 30 * DAY, fields.refreshToken ? fields.refreshExpires : fields.accessExpires) };
        await this.store.lock('session:' + attempt.sessionID, async () => {
          requireCondition(attempt.expires > this.store.now(), 401, 'OAUTH', 'This sign-in expired. Start again.');
          requireCondition(!this.store.get('session:' + attempt.sessionID, S.EncryptedRecord), 409, 'OAUTH', 'This session already exists. Start a new sign-in.');
          await this.store.consumeSecret('auth:' + input.attempt, 'session:' + attempt.sessionID, S.Session, session, this.keys.sessionSecret, this.#purpose, session.expires);
          this.remember(identity);
        });
        return view('ready');
      } catch (error) {
        this.store.delete('auth:' + input.attempt); throw error;
      }
    });
  }
  async #storedSession(key: string, origin: string): Promise<S.Session> {
    let data: S.Session | null;
    try { data = await this.store.secret(key, S.Session, this.keys.sessionSecret, this.#purpose); }
    catch { this.store.delete(key); throw new AppError(401, 'SESSION', 'Your session is invalid. Sign in again.'); }
    requireCondition(data && data.origin === origin && data.expires > this.store.now(), 401, 'SESSION', 'Your session expired or belongs to another website. Sign in again.');
    return data;
  }
  async identity(capability:string,origin:string,required=false):Promise<S.Session|null>{
    if(!capability){requireCondition(!required,401,'AUTH_REQUIRED','Sign in with GitHub to continue.');return null;}
    const key='session:'+await hash(capability);
    return this.#storedSession(key,origin);
  }
  /** Rotating credentials may be lost; the previously proven local author is not. */
  async session(capability:string,origin:string,required:boolean):Promise<AuthorizedSession|null>{
    if(!capability){requireCondition(!required,401,'AUTH_REQUIRED','Sign in with GitHub to continue.');return null;}
    const key='session:'+await hash(capability);
    return this.store.lock(key,async()=>{
      let data=await this.#storedSession(key,origin),credentials=data.credentials;
      requireCondition(credentials,401,'GITHUB_AUTH','Your GitHub authorization needs a new sign-in.');
      if(credentials.accessExpires<=this.store.now()+60000){
        const refreshToken=credentials.refreshToken;
        const expected=this.store.get(key,S.EncryptedRecord);
        requireCondition(expected,401,'SESSION','Your local session expired. Sign in again.');
        const retired=await this.store.putSecret(key,S.Session,{...data,credentials:null},this.keys.sessionSecret,this.#purpose,data.expires,expected);
        requireCondition(retired,401,'SESSION','Your local session ended. Sign in again.');
        requireCondition(refreshToken&&credentials.refreshExpires>this.store.now(),401,'GITHUB_AUTH','Your GitHub authorization expired. Sign in again.');
        try{
          const refreshed=await this.github.exchange({grant_type:'refresh_token',refresh_token:refreshToken});
          requireCondition(refreshed.refresh_token&&refreshed.refresh_token_expires_in,502,'UPSTREAM_SCHEMA','GitHub did not return complete rotating credentials.');
          requireCondition(data.expires>this.store.now(),401,'SESSION','Your local session expired. Sign in again.');
          credentials=this.#fields(refreshed);data={...data,credentials};
          requireCondition(await this.store.putSecret(key,S.Session,data,this.keys.sessionSecret,this.#purpose,data.expires,retired),401,'SESSION','Your local session ended. Sign in again.');
        }catch(error){if(error instanceof AppError&&error.code==='SESSION')throw error;throw new AppError(401,'GITHUB_AUTH','Your GitHub authorization could not be renewed. Sign in again.');}
      }
      return {...data,credentials};
    });
  }
  /** Retire only the credential that actually failed; keep the proven author. */
  async retire(capability:string,origin:string,token:string):Promise<void>{
    const key='session:'+await hash(capability);
    await this.store.lock(key,async()=>{
      let data:S.Session|null;
      try{data=await this.identity(capability,origin);}catch(error){if(error instanceof AppError&&error.code==='SESSION')return;throw error;}
      const expected=this.store.get(key,S.EncryptedRecord);
      if(expected&&data?.credentials?.accessToken===token)await this.store.putSecret(key,S.Session,{...data,credentials:null},this.keys.sessionSecret,this.#purpose,data.expires,expected);
    });
  }
  profile(principal:string):Person|null{return this.store.get('profile:'+principal,User);}
  remember(viewer:Viewer):Person{
    const {id,...profile}=viewer;
    this.store.put('profile:'+id,User,profile,this.store.now()+30*DAY);
    return profile;
  }
  async logout(capability: string, origin: string): Promise<{ ok: true }> {
    const allowedOrigin=origin;
    if (capability) {
      const key = 'session:' + await hash(capability);
      await this.#storedSession(key, allowedOrigin);
      this.store.delete(key);
    }
    return { ok: true };
  }
}
