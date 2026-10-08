import { challenge, randomProof } from './dom.js';
import type { Widget } from '../contracts/requests.js';
import type { Transport } from '../conversation/page.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export interface Login { capability: string; attempt: string; created: number; version: 4; status?: 'ready' | 'denied' }
export interface SessionHost {
  /** Parent bridge or native-page storage receives only the service capability. */
  emit(value: Record<string, unknown>): void;
  navigate(url: string): void | Promise<void>;
}
const capability = /^[A-Za-z0-9_-]{43}$/;
type AuthFlow = Login & { popup?: Window | null };
/** Shared authentication/transport for both embedding modes and custom views. */
export class BrowserSession implements Transport {
  #token = '';
  #principal: string | null = null;
  #login: AuthFlow | null = null;
  error = '';
  constructor(readonly service: string, readonly config: Pick<Widget, 'repo' | 'origin'>, readonly host: SessionHost, readonly changed: (identity: boolean) => void, readonly lifetime: AbortSignal) {
    const url = new URL(service);
    if (url.origin !== service || (!['https:', 'http:'].includes(url.protocol)) || (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS comments origin.');
    window.addEventListener('message', this.#message, { signal: lifetime });
    lifetime.addEventListener('abort', () => this.#retire(), { once: true });
  }
  get principal(): string | null { return this.#principal; }
  get signedIn(): boolean { return Boolean(this.#token); }
  get pending(): boolean { return Boolean(this.#login && Date.now() - this.#login.created < 600000); }
  #emit(identity = false): void { if (!this.lifetime.aborted) this.changed(identity); }
  #retire(flow = this.#login): void {
    if (!flow) return;
    if (this.#login === flow) this.#login = null;
    flow.popup?.close();
  }
  setSession(token: string): void {
    if (token && !capability.test(token)) return;
    if (this.#token === token) return;
    this.#token = token; this.#principal = null; this.error = ''; this.#emit(true);
  }
  fail(message: string): void { this.#failed(message); }
  async request<T>(path: string, body: unknown, signal?: AbortSignal, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    if (this.lifetime.aborted) throw new Error('This session has been disposed.');
    if (!/^[a-z]+(?:\/[a-z]+)?$/.test(path)) throw new Error('Invalid API operation.');
    const token = this.#token;
    const read = method === 'GET';
    const response=await fetch(this.service+'/api/v4/'+path+(read?'?'+new URLSearchParams({input:JSON.stringify(body)}):''),{
      method:read?'GET':'POST',headers:{...(read?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},
      ...(read?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:signal ? AbortSignal.any([this.lifetime, signal]) : this.lifetime,
    });
    let data: unknown; try { data = await response.json(); } catch { throw new ApiError('The comments service returned an invalid response.', response.status, 'UPSTREAM'); }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? (data as {error?: {message?: unknown; code?: unknown}}).error : undefined;
      if (response.status === 401 && !path.startsWith('auth/') && !this.lifetime.aborted && this.#token === token) { this.setSession(''); this.host.emit({ session: '' }); }
      throw new ApiError(typeof error?.message === 'string' ? error.message : 'Request failed.', response.status, typeof error?.code === 'string' ? error.code : 'UPSTREAM');
    }
    if (path === 'page' && token && this.#token === token && !this.lifetime.aborted) {
      const viewer = (data as {metadata?:{viewer?:{id?:unknown}}}).metadata?.viewer;
      if (typeof viewer?.id === 'string') this.#principal = viewer.id;
    }
    return data as T;
  }
  async signIn(mode:'popup'|'redirect'='redirect'): Promise<void> {
    if (this.lifetime.aborted) return;
    if (this.#login) this.host.emit({ clearPending: this.#login.attempt });
    this.#retire();
    const flow: AuthFlow = { capability: randomProof(), attempt: '', created: Date.now(), version: 4,
      popup: mode === 'redirect' ? null : window.open('about:blank', 'giscusflare-' + crypto.randomUUID(), 'popup,width=620,height=760') };
    this.#login = flow;this.error = '';
    let proof: string;
    try { proof = await challenge(flow.capability); flow.attempt = await challenge(proof); }
    catch (error) { this.#retire(flow); throw error; }
    if (this.lifetime.aborted || this.#login !== flow) { this.#retire(flow); return; }
    try {
      const { capability: saved, attempt, created, version } = flow;
      this.host.emit({ pending: { capability: saved, attempt, created, version } });
      const params = new URLSearchParams({ repo: this.config.repo, origin: this.config.origin, attempt: flow.attempt, mode: flow.popup ? 'popup' : 'redirect', openerOrigin: location.origin });
      const url = new URL(this.service + '/auth/window?' + params);
      url.hash = 'gw-proof=' + proof;
      if (flow.popup) { flow.popup.location.replace(url.toString()); flow.popup.focus(); }
      else await this.host.navigate(url.toString());
      this.#emit();
    } catch (error) { try { this.#failed(error instanceof Error ? error.message : 'Sign-in failed.', flow); } finally { throw error; } }
  }
  #message = (event: MessageEvent): void => {
    const flow = this.#login;
    if (!flow || event.origin !== this.service || event.source !== flow.popup) return;
    const done = event.data?.giscusAuthDone;
    if (this.#login === flow && done?.attempt === flow.attempt) {
      if (done.status === 'ready') void this.adopt(flow);
      else if (done.status === 'denied') this.#failed('Sign-in cancelled.', flow);
    }
  };
  async adopt(login: Login): Promise<void> {
    if (this.lifetime.aborted || login.version !== 4 || !Number.isFinite(login.created) || !capability.test(login.capability) || !capability.test(login.attempt)) return;
    if (this.#login && this.#login !== login && this.#login.attempt !== login.attempt) return;
    const flow = this.#login ?? { ...login };this.#login = flow;
    if (Date.now() - login.created >= 600000 || login.created > Date.now()) { this.#failed('Sign-in expired. Start again.', flow);return; }
    if (await challenge(await challenge(login.capability)) !== login.attempt || this.lifetime.aborted || this.#login !== flow) return;
    if (login.status === 'denied') { this.#failed('Sign-in cancelled.', flow);return; }
    this.#principal=null;this.#token=login.capability;this.host.emit({session:login.capability,clearPending:login.attempt});this.#retire(flow);this.error='';this.#emit(true);
  }
  #failed(message: string, flow = this.#login): void {
    if (this.lifetime.aborted || this.#login !== flow) return;
    try { if (flow) this.host.emit({clearPending:flow.attempt}); }
    finally { this.#retire(flow);this.error=message;this.#emit(); }
  }
  async signOut(): Promise<void> {
    const flow = this.#login;
    if (flow) {
      this.#retire(flow);
      try { this.host.emit({ clearPending: flow.attempt }); } finally { this.#emit(); }
    }
    const token = this.#token;
    try { await this.request('logout',{repo:this.config.repo,origin:this.config.origin}); }
    catch(error) { if(!(error instanceof ApiError && error.status===401))throw error; }
    if (!this.lifetime.aborted && this.#token === token) { this.setSession('');this.host.emit({signOut:true}); }
  }

}
