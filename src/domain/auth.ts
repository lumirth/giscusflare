import { parse } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import type { OAuthToken } from '../contracts/github.js';
import type { PublicConfig, RepositoryPolicy, SecretConfig } from '../contracts/config.js';
import { parentOrigin } from './authorization.js';
import { b64, equal, hash, random, unb64 } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import { GitHub } from './github.js';
import { Store } from './store.js';
const DAY = 86400000, TEN_MINUTES = 600000;
export type AuthStatus = { status: 'pending' | 'denied' } | { status: 'ready'; ticket: string };
export type CallbackResult = { status: 'ready' | 'denied'; attempt: string; ticket: string; repo: string; challenge: string; returnURL: string; mode: 'popup' | 'redirect' };
export function stateValue(repo: string, attempt: string): string { return b64(new TextEncoder().encode(repo)) + '.' + attempt; }
export function stateParts(state: string): { repo: string; attempt: string } {
  const match = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/.exec(state);
  requireCondition(match?.[1] && match[2], 400, 'OAUTH', 'Invalid authorization state.');
  const repo = new TextDecoder('utf-8', { fatal: true }).decode(unb64(match[1]));
  return parse(R.AuthStartQuery, { repo, attempt: match[2] });
}
export function cookieName(origin: string, attempt: string): string { return (origin.startsWith('https:') ? '__Host-' : '') + 'gw-auth-' + attempt.slice(0, 16); }
export class Auth {
  #purpose: string;
  constructor(readonly config: PublicConfig, readonly keys: SecretConfig, readonly repo: string, readonly policy: RepositoryPolicy, readonly store: Store, readonly github: GitHub) {
    this.#purpose = `${config.appId}:${config.clientId}:${repo}`;
  }
  #fields(data: OAuthToken): Pick<S.Session, 'accessToken' | 'accessExpires' | 'refreshToken' | 'refreshExpires'> {
    const now = this.store.now();
    return { accessToken: data.access_token, accessExpires: now + (data.expires_in ? data.expires_in * 1000 : 30 * DAY),
      refreshToken: data.refresh_token || null, refreshExpires: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : 0 };
  }
  async prepare(raw: C.PrepareCall): Promise<{ attempt: string; authorizeURL: string }> {
    const input = parse(C.PrepareCall, raw), request = input.request;
    const origin = parentOrigin(this.policy, request.origin);
    const attempt = random(), githubVerifier = random(), now = this.store.now();
    const url = new URL(request.origin); url.hash = ''; url.searchParams.delete('giscus');
    const record: S.OAuthAttempt = { version: 2, repo: this.repo, origin, returnURL: url.toString(), mode: request.mode,
      challenge: request.challenge, githubVerifier, cookieHash: await hash(input.browserCookie), created: now, expires: now + TEN_MINUTES,
      status: 'pending', credentials: null, ticket: null };
    await this.store.putSecret('auth:' + attempt, S.OAuthAttempt, record, this.keys.sessionSecret, this.#purpose, record.expires);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.origin + '/auth/callback', state: stateValue(this.repo, attempt), code_challenge: await hash(githubVerifier), code_challenge_method: 'S256' }).toString();
    return { attempt, authorizeURL: authorize.toString() };
  }
  async #attempt(id: string): Promise<S.OAuthAttempt> {
    let attempt: S.OAuthAttempt | null;
    try { attempt = await this.store.secret('auth:' + id, S.OAuthAttempt, this.keys.sessionSecret, this.#purpose); }
    catch { this.store.delete('auth:' + id); throw new AppError(401, 'OAUTH', 'This sign-in attempt is invalid. Start again.'); }
    requireCondition(attempt && attempt.repo === this.repo && attempt.expires > this.store.now(), 401, 'OAUTH', 'This sign-in attempt expired or was already used. Start again.');
    parentOrigin(this.policy, attempt.origin); return attempt;
  }
  async #saveAttempt(id: string, data: S.OAuthAttempt): Promise<void> {
    await this.store.putSecret('auth:' + id, S.OAuthAttempt, data, this.keys.sessionSecret, this.#purpose, data.expires);
  }
  async callback(raw: C.CallbackCall): Promise<CallbackResult> {
    const input = parse(C.CallbackCall, raw);
    return this.store.lock('auth:' + input.attempt, async () => {
      const attempt = await this.#attempt(input.attempt);
      requireCondition(input.browserCookie && equal(await hash(input.browserCookie), attempt.cookieHash), 401, 'OAUTH', 'Sign-in must finish in the browser that started it.');
      requireCondition(attempt.status === 'pending', 409, 'OAUTH', 'This sign-in callback was already used.');
      const view = (status: 'ready' | 'denied', ticket = ''): CallbackResult => ({ status, ticket, attempt: input.attempt, repo: this.repo, challenge: attempt.challenge, returnURL: attempt.returnURL, mode: attempt.mode });
      if (input.denied) { attempt.status = 'denied'; await this.#saveAttempt(input.attempt, attempt); return view('denied'); }
      requireCondition(input.code, 400, 'OAUTH', 'GitHub did not return an authorization code.');
      attempt.status = 'exchanging'; await this.#saveAttempt(input.attempt, attempt);
      try {
        const token = await this.github.exchange({ code: input.code, code_verifier: attempt.githubVerifier, redirect_uri: this.config.origin + '/auth/callback' });
        const user = await this.github.viewer(token.access_token), fields = this.#fields(token);
        attempt.credentials = { ...fields, user, repo: this.repo, origin: attempt.origin,
          expires: Math.min(this.store.now() + 30 * DAY, fields.refreshToken ? fields.refreshExpires : fields.accessExpires) };
        attempt.ticket = random(); attempt.status = 'ready'; await this.#saveAttempt(input.attempt, attempt);
        return view('ready', attempt.ticket);
      } catch (error) {
        attempt.status = 'denied'; attempt.credentials = null; attempt.ticket = null;
        await this.#saveAttempt(input.attempt, attempt); throw error;
      }
    });
  }
  async #proof(input: R.AuthProof): Promise<S.OAuthAttempt> {
    const attempt = await this.#attempt(input.attempt);
    const origin = parentOrigin(this.policy, input.origin);
    requireCondition(origin === attempt.origin && equal(await hash(input.verifier), attempt.challenge), 403, 'OAUTH', 'This sign-in belongs to a different browser or website.');
    return attempt;
  }
  async poll(raw: R.AuthProof): Promise<AuthStatus> {
    const input = parse(R.AuthProof, raw), attempt = await this.#proof(input);
    if (attempt.status === 'ready') { requireCondition(attempt.ticket, 503, 'STORAGE', 'The sign-in result is incomplete.'); return { status: 'ready', ticket: attempt.ticket }; }
    return { status: attempt.status === 'denied' ? 'denied' : 'pending' };
  }
  async consume(raw: R.AuthConsume): Promise<{ session: string }> {
    const input = parse(R.AuthConsume, raw);
    return this.store.lock('auth:' + input.attempt, async () => {
      const attempt = await this.#proof(input);
      requireCondition(attempt.status === 'ready' && attempt.credentials && attempt.ticket && equal(attempt.ticket, input.ticket), 401, 'OAUTH', 'Could not finish sign-in. Start again.');
      const session = random(), id = await hash(session);
      await this.store.putSecret('session:' + id, S.Session, attempt.credentials, this.keys.sessionSecret, this.#purpose, attempt.credentials.expires);
      this.store.delete('auth:' + input.attempt); return { session };
    });
  }
  async session(capability: string, page: string, required: boolean): Promise<S.Session | null> {
    if (!capability) { requireCondition(!required, 401, 'AUTH_REQUIRED', 'Sign in with GitHub to continue.'); return null; }
    const origin = parentOrigin(this.policy, page), key = 'session:' + await hash(capability);
    return this.store.lock(key, async () => {
      let data: S.Session | null;
      try { data = await this.store.secret(key, S.Session, this.keys.sessionSecret, this.#purpose); }
      catch { this.store.delete(key); throw new AppError(401, 'SESSION', 'Your session is invalid. Sign in again.'); }
      requireCondition(data && data.repo === this.repo && data.origin === origin && data.expires > this.store.now(), 401, 'SESSION', 'Your session expired or belongs to another website. Sign in again.');
      if (data.accessExpires <= this.store.now() + 60000) {
        if (!data.refreshToken || data.refreshExpires <= this.store.now()) { this.store.delete(key); throw new AppError(401, 'SESSION', 'Your GitHub authorization expired. Sign in again.'); }
        try {
          const refreshed = await this.github.exchange({ grant_type: 'refresh_token', refresh_token: data.refreshToken });
          requireCondition(refreshed.refresh_token && refreshed.refresh_token_expires_in, 502, 'UPSTREAM_SCHEMA', 'GitHub did not return a complete refreshed session. Sign in again.');
          data = { ...data, ...this.#fields(refreshed) };
          await this.store.putSecret(key, S.Session, data, this.keys.sessionSecret, this.#purpose, data.expires);
        } catch (error) {
          // An uncertain rotating refresh can make the old refresh token unusable.
          // Remove the local session when GitHub rejects a refresh.
          this.store.delete(key);
          throw new AppError(401, 'SESSION', 'Your GitHub session could not be renewed. Sign in again.');
        }
      }
      return data;
    });
  }
  async logout(capability: string, origin: string): Promise<{ ok: true }> {
    await this.session(capability, origin, false);
    if (capability) { const key = 'session:' + await hash(capability); await this.store.lock(key, async () => this.store.delete(key)); }
    return { ok: true };
  }
}
