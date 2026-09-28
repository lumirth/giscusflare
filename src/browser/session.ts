import { challenge, randomProof } from './dom.js';
import type { Widget } from '../contracts/requests.js';
import type { Transport } from '../conversation/controller.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export interface Login { verifier: string; challenge: string; attempt: string; created: number }
export interface SessionHost {
  /** Parent bridge or native-page storage receives only the service capability. */
  emit(value: Record<string, unknown>): void;
  navigate(url: string): void;
}
const capability = /^[A-Za-z0-9_-]{43}$/;
/** Shared authentication/transport for both embedding modes and custom views. */
export class BrowserSession implements Transport {
  #token = '';
  #revision = 0;
  #login: Login | null = null;
  #popup: Window | null = null;
  #timer?: ReturnType<typeof setTimeout>;
  #consuming = false;
  #disposed = false;
  #listeners = new Set<() => void>();
  error = '';
  constructor(readonly service: string, readonly config: Widget, readonly host: SessionHost) {
    const url = new URL(service);
    if (url.origin !== service || (!['https:', 'http:'].includes(url.protocol)) || (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS comments origin.');
    window.addEventListener('message', this.#message);
    document.addEventListener('visibilitychange', this.#focus);
  }
  /** Changes with identity without exposing the bearer capability. */
  get revision(): number { return this.#revision; }
  get signedIn(): boolean { return Boolean(this.#token); }
  get pending(): boolean { return Boolean(this.#login); }
  subscribe(fn: () => void): () => void { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
  #emit(): void { if (!this.#disposed) for (const fn of this.#listeners) fn(); }
  setSession(token: string): void {
    if (token && !capability.test(token)) return;
    if (this.#token === token) return;
    this.#token = token; this.#revision++; this.error = ''; this.#emit();
  }
  async request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (this.#disposed) throw new Error('This session has been disposed.');
    if (!/^[a-z]+(?:\/[a-z]+)?$/.test(path)) throw new Error('Invalid API operation.');
    const read=['config','counts','thread','replies','ranking','hydrate'].includes(path);
    const response=await fetch(this.service+'/api/v2/'+path+(read?'?'+new URLSearchParams({input:JSON.stringify(body)}):''),{
      method:read?'GET':'POST',headers:{...(read?{}:{'Content-Type':'application/json'}),...(this.#token?{Authorization:'Bearer '+this.#token}:{})},
      ...(read?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal,
    });
    let data: unknown; try { data = await response.json(); } catch { throw new ApiError('The comments service returned an invalid response.', response.status, 'UPSTREAM'); }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? (data as {error?: {message?: unknown; code?: unknown}}).error : undefined;
      if (response.status === 401) { this.setSession(''); this.host.emit({ signOut: true }); }
      throw new ApiError(typeof error?.message === 'string' ? error.message : 'Request failed.', response.status, typeof error?.code === 'string' ? error.code : 'UPSTREAM');
    }
    return data as T;
  }
  async signIn(mode:'popup'|'redirect'='redirect'): Promise<void> {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    this.#popup?.close();
    this.#popup = mode==='redirect'?null:window.open('about:blank','giscusflare-' + crypto.randomUUID(),'popup,width=620,height=760');
    const verifier = randomProof(), proof = await challenge(verifier);
    if (this.#disposed) { this.#popup?.close(); return; }
    this.#login = { verifier, challenge: proof, attempt: '', created: Date.now() };
    this.host.emit({ pending: this.#login });
    const params = new URLSearchParams({ repo: this.config.repo, origin: this.config.origin, challenge: proof, mode: this.#popup ? 'popup' : 'redirect', openerOrigin: location.origin });
    const url = this.service + '/auth/window?' + params;
    if (this.#popup) { this.#popup.location.replace(url); this.#popup.focus(); }
    else this.host.navigate(url);
    this.#emit();
  }
  #message = (event: MessageEvent): void => {
    if (event.origin !== this.service || event.source !== this.#popup || !this.#login) return;
    const ready = event.data?.giscusAuth;
    if (ready && capability.test(ready.attempt) && ready.challenge === this.#login.challenge) {
      this.#login.attempt = ready.attempt; this.#popup?.postMessage({giscusAuthAck: ready.attempt},this.service);
      this.host.emit({pending: this.#login});this.#schedule(1000);
    }
    const done = event.data?.giscusAuthDone;
    if (done?.attempt === this.#login.attempt && done.challenge === this.#login.challenge) {
      if (done.status === 'ready' && typeof done.ticket === 'string' && capability.test(done.ticket)) void this.finish(done.ticket,this.#login);
      else if (done.status === 'denied') this.#failed('Sign-in cancelled.');
    }
  };
  #focus = (): void => { if (!document.hidden && this.#login && !this.#consuming) this.#schedule(0); };
  #schedule(ms: number): void { clearTimeout(this.#timer); if (!this.#disposed && this.#login?.attempt) this.#timer = setTimeout(() => void this.#poll(), ms); }
  async #poll(): Promise<void> {
    const login = this.#login; if (!login?.attempt || this.#consuming || this.#disposed) return;
    if (Date.now() - login.created >= 600000) { this.#failed('Sign-in expired. Start again.'); return; }
    if (document.hidden) { this.#schedule(10000); return; }
    try {
      const result = await this.request<{status: string; ticket?: string}>('auth/poll', { repo:this.config.repo, origin:this.config.origin, attempt:login.attempt, verifier:login.verifier });
      if (this.#login !== login || this.#disposed) return;
      if (result.status === 'ready' && result.ticket) { await this.finish(result.ticket,login); return; }
      if (result.status === 'denied') { this.#failed('Sign-in cancelled.'); return; }
    } catch(error) { if (error instanceof ApiError && [400,401,403,409].includes(error.status)) { this.#failed(error.message); return; } }
    this.#schedule(Date.now()-login.created<60000?10000:20000);
  }
  async finish(ticket: string, login: Login): Promise<void> {
    if (this.#consuming || this.#disposed) return;
    this.#consuming = true; clearTimeout(this.#timer);
    try {
      const result = await this.request<{session:string}>('auth/consume',{repo:this.config.repo,origin:this.config.origin,attempt:login.attempt,verifier:login.verifier,ticket});
      if (!capability.test(result.session)) throw new Error('Sign-in returned an invalid session.');
      if (this.#disposed) return;
      this.#token=result.session;this.#revision++;this.host.emit({session:result.session,clearPending:login.challenge});this.#login=null;this.error='';this.#emit();
    } catch(error) { this.#failed(error instanceof Error?error.message:'Sign-in failed.'); }
    finally { this.#consuming=false; }
  }
  #failed(message: string): void {
    clearTimeout(this.#timer);if(this.#login)this.host.emit({clearPending:this.#login.challenge});this.#login=null;this.error=message;this.#emit();
  }
  async signOut(): Promise<void> {
    try { await this.request('logout',{repo:this.config.repo,origin:this.config.origin}); }
    catch(error) { if(!(error instanceof ApiError && error.status===401))throw error; }
    this.setSession('');this.host.emit({signOut:true});
  }
  dispose(): void { this.#disposed=true;clearTimeout(this.#timer);window.removeEventListener('message',this.#message);document.removeEventListener('visibilitychange',this.#focus);this.#listeners.clear(); }
}
