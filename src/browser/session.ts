import { challenge, randomProof } from './dom.js';
import type { Widget } from '../contracts/requests.js';
import type { SavedWriting } from '../conversation/writing.js';
import type { Transport } from '../conversation/page.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly phase: 'not-issued' | 'unknown' = 'not-issued') { super(message); }
}
export interface Login { capability: string; attempt: string; created: number; version: 5; status?: 'ready' | 'denied' }
export type SessionChange = 'identity' | 'verified' | 'changed';
export interface SessionHost {
  restoreWriting?(id: string): Promise<SavedWriting | undefined>;
  /** Parent bridge or native-page storage receives only the service capability. */
  emit(value: Record<string, unknown>): void;
  navigate(url: string): void | Promise<void>;
}
const capability = /^[A-Za-z0-9_-]{43}$/;
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
  #login: AuthFlow | null = null;
  #verification?: {token: string; work: Promise<void>};
  error = '';
  needsAuthorization = false;
  constructor(readonly service: string, readonly config: Pick<Widget, 'repo' | 'origin' | 'returnURL' | 'registration'>, readonly host: SessionHost, readonly changed: (change: SessionChange) => void, readonly lifetime: AbortSignal) {
    const url = new URL(service);
    if (url.origin !== service || (!['https:', 'http:'].includes(url.protocol)) || (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS comments origin.');
    window.addEventListener('message', this.#message, { signal: lifetime });
    lifetime.addEventListener('abort', () => this.#retire(), { once: true });
  }
  get principal(): string | null { return this.#principal; }
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
    this.#token = token; this.#principal = null; this.error = ''; this.needsAuthorization = false; this.#emit('identity');
    if (token) void this.verify();
  }
  fail(message: string): void { this.#failed(message); }
  verify(): Promise<void> {
    const token = this.#token;
    if (!token || this.#principal) return Promise.resolve();
    if (this.#verification?.token === token) return this.#verification.work;
    const work = this.#request<{principal: string | null; needsAuthorization: boolean}>('session', this.#context(), undefined, 'POST', token).then(result => {
      if (this.lifetime.aborted || this.#token !== token || this.#principal) return;
      if (typeof result.principal !== 'string' || !result.principal) throw new Error('The comments service did not verify this session.');
      this.#principal = result.principal;this.needsAuthorization = result.needsAuthorization === true;this.error = '';this.#emit('verified');
    }).catch(cause => {
      if (!this.lifetime.aborted && this.#token === token && !this.#principal) { this.error = cause instanceof Error ? cause.message : 'Unable to verify sign-in.';this.#emit(); }
    }).finally(() => { if (this.#verification?.work === work) this.#verification = undefined; });
    this.#verification = {token, work};return work;
  }
  #context() { const {repo,origin,registration} = this.config; return {repo,origin,...(registration ? {registration} : {})}; }
  request<T>(path: string, body: unknown, signal?: AbortSignal, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    return this.#request(path, body, signal, method, ['counts', 'ranking', 'content', 'page'].includes(path) ? '' : this.#token);
  }
  async #request<T>(path: string, body: unknown, signal: AbortSignal | undefined, method: 'GET' | 'POST', token: string): Promise<T> {
    if (this.lifetime.aborted) throw new ApiError('This session has been disposed.', 0, 'SESSION');
    if (!/^[a-z]+(?:\/[a-z]+)?$/.test(path)) throw new ApiError('Invalid API operation.', 0, 'BAD_INPUT');
    const read = method === 'GET', dispatchedPhase = path === 'contribute' ? 'unknown' : 'not-issued';
    let encoded: string;
    try { signal?.throwIfAborted();encoded = JSON.stringify(body); }
    catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'Invalid API request.', 0, 'BAD_INPUT'); }
    let response: Response;
    try { response = await fetch(this.service + '/api/v6/' + path + (read ? '?' + new URLSearchParams({input: encoded}) : ''), {
      method, headers: {...(read ? {} : {'Content-Type': 'application/json'}), ...(token ? {Authorization: 'Bearer ' + token} : {})},
      ...(read ? {} : {body: encoded}), credentials: 'omit', cache: 'no-store', signal: signal ? AbortSignal.any([this.lifetime, signal]) : this.lifetime,
    }); } catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'The comments service could not be reached.', 0, 'UPSTREAM', dispatchedPhase); }
    let data: unknown;try { data = await response.json(); } catch { throw new ApiError('The comments service returned an invalid response.', response.status, 'UPSTREAM', dispatchedPhase); }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? (data as {error?: {message?: unknown; code?: unknown;phase?: unknown}}).error : undefined;
      if (response.status === 401 && ['SESSION','AUTH_REQUIRED'].includes(String(error?.code)) && token && !path.startsWith('auth/') && !this.lifetime.aborted && this.#token === token) { this.setSession('');this.host.emit({session: ''}); }
      if (error?.code === 'GITHUB_AUTH' && token && this.#token === token) { this.needsAuthorization = true;this.#emit(); }
      throw new ApiError(typeof error?.message === 'string' ? error.message : 'Request failed.', response.status, typeof error?.code === 'string' ? error.code : 'UPSTREAM', error?.phase === 'not-issued' || error?.phase === 'unknown' ? error.phase : dispatchedPhase);
    }
    if (token && this.#token === token && !this.lifetime.aborted) {
      const access = path === 'access' ? data as {principal: {id: string}} : undefined;
      if (access?.principal?.id === this.#principal) { this.needsAuthorization = false;this.error = ''; }
    }
    return data as T;
  }
  async signIn(mode:'popup'|'redirect'='redirect'): Promise<void> {
    if (this.lifetime.aborted) return;
    if (this.#login) this.host.emit({ clearPending: this.#login.attempt });
    this.#retire();
    const flow: AuthFlow = { capability: randomProof(), attempt: '', created: Date.now(), version: 5,
      popup: mode === 'redirect' ? null : window.open('about:blank', 'giscusflare-' + crypto.randomUUID(), 'popup,width=620,height=760') };
    this.#login = flow;this.error = '';
    let proof: string;
    try { proof = await challenge(flow.capability); flow.attempt = await challenge(proof); }
    catch (error) { this.#retire(flow); throw error; }
    if (this.lifetime.aborted || this.#login !== flow) { this.#retire(flow); return; }
    try {
      const { capability: saved, attempt, created, version } = flow;
      this.host.emit({ pending: { capability: saved, attempt, created, version } });
      const params = new URLSearchParams({ ...this.#context(), returnURL: this.config.returnURL, attempt: flow.attempt, mode: flow.popup ? 'popup' : 'redirect', openerOrigin: location.origin });
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
    if (this.lifetime.aborted || !validLogin(login)) return;
    if (this.#login && this.#login !== login && this.#login.attempt !== login.attempt) return;
    const flow = this.#login ?? { ...login };this.#login = flow;
    const matched = await challenge(await challenge(login.capability)) === login.attempt;
    if (this.lifetime.aborted || this.#login !== flow) return;
    if (!matched) { this.#failed('Invalid sign-in return.', flow);return; }
    if (login.status === 'denied') { this.#failed('Sign-in cancelled.', flow);return; }
    this.host.emit({session: login.capability, clearPending: login.attempt});this.#retire(flow);
    const same = this.#token === login.capability;this.setSession(login.capability);if (same) this.#emit();
  }
  #failed(message: string, flow = this.#login): void {
    if (this.lifetime.aborted || this.#login !== flow) return;
    try { if (flow) this.host.emit({clearPending:flow.attempt}); }
    finally { this.#retire(flow);this.error=message;this.#emit(); }
  }
  async signOut(): Promise<void> {
    const flow = this.#login, token = this.#token;
    this.#retire(flow);
    this.setSession('');
    this.host.emit({signOut: true, ...(flow ? {clearPending: flow.attempt} : {})});
    if (!token) { this.#emit();return; }
    try { await this.#request('logout', this.#context(), undefined, 'POST', token); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
  }
}
