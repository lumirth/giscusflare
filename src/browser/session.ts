import { challenge, randomProof } from './dom.js';
import { ApiError, requestJSON, validateService } from './http.js';
export {ApiError} from './http.js';
import type { Widget } from '../contracts/requests.js';
import type { Person, Viewer } from '../contracts/document.js';
import type { Transport } from '../conversation/page.js';
import { isWebURL } from '../contracts/primitives.js';

export interface Login { capability: string; attempt: string; created: number; version: 5; status?: 'ready' | 'denied' }
export interface DisplayProfile { fingerprint: string; profile: Person }
export type SessionChange = 'identity' | 'verified' | 'changed';
export interface SessionHost {
  saveSession?(value: string): void;
  saveDisplayProfile?(fingerprint: string, profile: Person): void | Promise<void>;
  pendingLogin?(value: Login): void;
  clearPending?(attempt?: string): void;
  navigate(url: string): void | boolean | Promise<void | boolean>;
}

const capability = /^[A-Za-z0-9_-]{43}$/;
export function validDisplayProfile(value: unknown): value is Person {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<Person>;
  return typeof profile.login === 'string' && profile.login.length > 0 && profile.login.length <= 100 &&
    typeof profile.url === 'string' && isWebURL(profile.url) && typeof profile.avatarUrl === 'string' &&
    (!profile.avatarUrl || isWebURL(profile.avatarUrl));
}
export function validDisplayProfileHint(value: unknown): value is DisplayProfile {
  if (!value || typeof value !== 'object') return false;
  const hint = value as Partial<DisplayProfile>;
  return typeof hint.fingerprint === 'string' && capability.test(hint.fingerprint) && validDisplayProfile(hint.profile);
}
export function validLogin(value: unknown): value is Login {
  if (!value || typeof value !== 'object') return false;
  const login = value as Partial<Login>;
  return login.version === 5 && typeof login.capability === 'string' && capability.test(login.capability) &&
    typeof login.attempt === 'string' && capability.test(login.attempt) && typeof login.created === 'number' &&
    login.created <= Date.now() && Date.now() - login.created < 600000 &&
    (login.status === undefined || login.status === 'ready' || login.status === 'denied');
}
type AuthFlow = Login & { popup?: Window | null };
/** Shared authentication/transport for both embedding modes and custom views. */
export class BrowserSession implements Transport {
  #token = '';
  #principal: string | null = null;
  #profile: Person | null = null;
  #displayProfile: Person | null = null;
  #identity?: Promise<void>;
  #login: AuthFlow | null = null;
  #verification?: {token: string; work: Promise<void>};
  #failure?: {operation:'identity'|'session'|'login';message:string};
  get error(): string { return this.#failure?.message || ''; }
  needsAuthorization = false;
  constructor(readonly service: string, readonly config: Pick<Widget, 'repo' | 'origin' | 'returnURL' | 'registration'>, readonly host: SessionHost, readonly changed: (change: SessionChange) => void, readonly lifetime: AbortSignal) {
    validateService(service);
    window.addEventListener('message', this.#message, { signal: lifetime });
    lifetime.addEventListener('abort', () => this.#retire(), { once: true });
  }
  get principal(): string | null { return this.#principal; }
  get viewer(): Viewer | null { return this.#principal && this.#profile ? {...this.#profile,id:this.#principal} : null; }
  get displayProfile(): Person | null { return this.#token ? this.#profile ?? this.#displayProfile : null; }
  get signedIn(): boolean { return Boolean(this.#token); }
  get pending(): boolean { return Boolean(this.#login && Date.now() - this.#login.created < 600000); }
  #emit(change: SessionChange = 'changed'): void { if (!this.lifetime.aborted) this.changed(change); }
  #retire(flow = this.#login): void {
    if (!flow) return;
    if (this.#login === flow) this.#login = null;
    flow.popup?.close();
  }
  setSession(token: string): void {
    if (token && !capability.test(token)) return;
    if (this.#token === token) return;
    this.#token = token; this.#principal = null; this.#profile = null; this.#displayProfile = null; this.#identity = undefined; this.#verification = undefined; this.#failure = undefined; this.needsAuthorization = false; this.#emit('identity');
    if (token) void this.verify();
  }
  async restoreDisplayProfile(hint: DisplayProfile): Promise<void> {
    const token = this.#token;
    if (!token || this.#profile || this.lifetime.aborted || !validDisplayProfileHint(hint)) return;
    try {
      if (await challenge(token) === hint.fingerprint && this.#token === token && !this.#profile && !this.lifetime.aborted) { this.#displayProfile = hint.profile;this.#emit(); }
    } catch {}
  }
  #rememberProfile(token: string, profile: Person): void {
    if (!this.host.saveDisplayProfile) return;
    void challenge(token).then(fingerprint => {
      if (!this.lifetime.aborted && this.#token === token) return this.host.saveDisplayProfile?.(fingerprint, profile);
    }).catch(() => {});
  }
  fail(message: string): void { this.#failed(message); }
  verify(): Promise<void> {
    const token = this.#token;
    if (this.#principal && !this.needsAuthorization && this.#failure?.operation === 'identity') return this.refreshIdentity();
    if (!token || this.#principal) return Promise.resolve();
    if (this.#verification?.token === token) return this.#verification.work;
    const work = this.#request<{principal: string | null; profile: Person | null; needsAuthorization: boolean}>('session', this.#context(), undefined, 'POST', token).then(result => {
      if (this.lifetime.aborted || this.#token !== token || this.#verification?.work !== work) return;
      if (typeof result.principal !== 'string' || !result.principal) throw new Error('The comments service did not verify this session.');
      if (this.#principal && this.#principal !== result.principal) { this.setSession('');this.host.saveSession?.('');throw new ApiError('The account identity changed.', 401, 'SESSION'); }
      const verified = !this.#principal;
      this.#principal = result.principal;this.#profile = result.profile;if (result.profile) this.#rememberProfile(token, result.profile);if (verified) this.needsAuthorization = result.needsAuthorization === true;if (this.#failure?.operation === 'session') this.#failure = undefined;this.#emit(verified ? 'verified' : 'changed');
      if (!this.#profile && !this.needsAuthorization) void this.refreshIdentity();
    }).catch(cause => {
      if (!this.lifetime.aborted && this.#token === token && this.#verification?.work === work && !this.#profile) { this.#failure = {operation:this.#principal ? 'identity' : 'session',message:cause instanceof Error ? cause.message : 'Unable to verify sign-in.'};this.#emit(); }
    }).finally(() => { if (this.#verification?.work === work) this.#verification = undefined; });
    this.#verification = {token, work};return work;
  }
  /** Display identity is local when retained; a missing or deliberately refreshed profile needs no discussion. */
  refreshIdentity(): Promise<void> {
    if (!this.#principal || this.lifetime.aborted) return Promise.resolve();
    if (this.#identity) return this.#identity;
    const token = this.#token, principal = this.#principal;
    const work = this.#request<{principal:string;profile:Person}>('identity', this.#context(), undefined, 'POST', token).then(result => {
      if (this.lifetime.aborted || token !== this.#token || principal !== this.#principal || this.#identity !== work) return;
      if (result.principal !== principal) { this.setSession('');this.host.saveSession?.('');throw new ApiError('The account identity changed.', 401, 'SESSION'); }
      this.#profile = result.profile;this.#rememberProfile(token, result.profile);if (this.#failure?.operation === 'identity') this.#failure = undefined;this.#emit();
    }).catch(cause => {
      if (!this.lifetime.aborted && token === this.#token && this.#identity === work) { this.#failure = {operation:'identity',message:cause instanceof Error ? cause.message : 'Unable to load account identity.'};this.#emit(); }
    }).finally(() => { if (this.#identity === work) this.#identity = undefined; });
    this.#identity = work;return work;
  }
  #context() { const {repo,origin,registration} = this.config; return {repo,origin,...(registration ? {registration} : {})}; }
  request<T>(path: string, body: unknown, signal?: AbortSignal, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    return this.#request(path, body, signal, method, ['counts', 'ranking', 'content', 'page'].includes(path) ? '' : this.#token);
  }
  async #request<T>(path: string, body: unknown, signal: AbortSignal | undefined, method: 'GET' | 'POST', token: string): Promise<T> {
    if (this.lifetime.aborted) throw new ApiError('This session has been disposed.', 0, 'SESSION');
    let data:T;
    try { data = await requestJSON<T>(this.service, path, body, {method, bearer:token, cache:'no-store', signal:signal ? AbortSignal.any([this.lifetime,signal]) : this.lifetime, failurePhase:path === 'contribute' ? 'unknown' : 'not-issued'}); }
    catch (error) {
      if (error instanceof ApiError && token && this.#token === token && !this.lifetime.aborted) {
        if (error.status === 401 && ['SESSION','AUTH_REQUIRED'].includes(error.code) && !path.startsWith('auth/')) { this.setSession('');this.host.saveSession?.(''); }
        if (error.code === 'GITHUB_AUTH') { this.needsAuthorization = true;this.#emit(); }
      }
      throw error;
    }
    if (token && this.#token === token && !this.lifetime.aborted) {
      const access = path === 'access' ? data as {principal: string} : undefined;
      if (access) {
        if (typeof access.principal !== 'string' || !access.principal) throw new Error('The comments service did not verify this account.');
        if (this.#principal && access.principal !== this.#principal) { this.setSession('');this.host.saveSession?.('');throw new ApiError('The account identity changed.', 401, 'SESSION'); }
        const verified = !this.#principal;
        this.#principal = access.principal;this.needsAuthorization = false;if (this.#failure?.operation === 'session') this.#failure = undefined;
        if (verified) this.#emit('verified');
      }
    }
    return data as T;
  }
  async signIn(mode:'popup'|'redirect'='redirect'): Promise<void> {
    if (this.lifetime.aborted) return;
    if (this.#login) this.host.clearPending?.(this.#login.attempt);
    this.#retire();
    const flow: AuthFlow = { capability: randomProof(), attempt: '', created: Date.now(), version: 5,
      popup: mode === 'redirect' ? null : window.open('about:blank', 'giscusflare-' + crypto.randomUUID(), 'popup,width=620,height=760') };
    this.#login = flow;this.#failure = undefined;
    let proof: string;
    try { proof = await challenge(flow.capability); flow.attempt = await challenge(proof); }
    catch (error) { this.#retire(flow); throw error; }
    if (this.lifetime.aborted || this.#login !== flow) { this.#retire(flow); return; }
    try {
      const { capability: saved, attempt, created, version } = flow;
      this.host.pendingLogin?.({capability:saved,attempt,created,version});
      const params = new URLSearchParams({ ...this.#context(), returnURL: this.config.returnURL, attempt: flow.attempt, mode: flow.popup ? 'popup' : 'redirect', openerOrigin: location.origin });
      const url = new URL(this.service + '/auth/window?' + params);
      url.hash = 'gw-proof=' + proof;
      if (flow.popup) { flow.popup.location.replace(url.toString()); flow.popup.focus(); }
      else if (await this.host.navigate(url.toString()) === false) throw new Error('Invalid sign-in destination.');
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
    if (this.lifetime.aborted || !validLogin(login)) return;
    if (this.#login && this.#login !== login && this.#login.attempt !== login.attempt) return;
    const flow = this.#login ?? { ...login };this.#login = flow;
    const matched = await challenge(await challenge(login.capability)) === login.attempt;
    if (this.lifetime.aborted || this.#login !== flow) return;
    if (!matched) { this.#failed('Invalid sign-in return.', flow);return; }
    if (login.status === 'denied') { this.#failed('Sign-in cancelled.', flow);return; }
    this.host.saveSession?.(login.capability);this.host.clearPending?.(login.attempt);this.#retire(flow);
    const same = this.#token === login.capability;this.setSession(login.capability);if (same) this.#emit();
  }
  #failed(message: string, flow = this.#login): void {
    if (this.lifetime.aborted || this.#login !== flow) return;
    try { if (flow) this.host.clearPending?.(flow.attempt); }
    finally { this.#retire(flow);this.#failure={operation:'login',message};this.#emit(); }
  }
  async signOut(): Promise<void> {
    const flow = this.#login, token = this.#token;
    this.#retire(flow);
    this.setSession('');
    this.host.saveSession?.('');this.host.clearPending?.();
    if (!token) { this.#emit();return; }
    try { await this.#request('logout', this.#context(), undefined, 'POST', token); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
  }
}
