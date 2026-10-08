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
export type CallbackResult = { status: 'ready' | 'denied'; attempt: string; repo: string; returnURL: string; mode: 'popup' | 'redirect'; openerOrigin: string };
export function stateValue(repo: string, attempt: string): string { return b64(new TextEncoder().encode(repo)) + '.' + attempt; }
export function stateParts(state: string): { repo: string; attempt: string } {
  const match = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/.exec(state);
  requireCondition(match?.[1] && match[2], 400, 'OAUTH', 'Invalid authorization state.');
  const repo = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(unb64(match[1]));
  return parse(R.AuthStartQuery, { repo, attempt: match[2] });
}
export function cookieName(origin: string, attempt: string): string { return (origin.startsWith('https:') ? '__Host-' : '') + 'gw-auth-' + attempt.slice(0, 16); }
export class Auth {
  #purpose: string;
  constructor(readonly config: PublicConfig, readonly keys: SecretConfig, readonly repo: string, repositoryId: string, readonly policy: RepositoryPolicy, readonly store: Store, readonly github: GitHub) {
    this.#purpose = `${config.appId}:${config.clientId}:${repositoryId}`;
  }
  #fields(data: OAuthToken): S.Session['credentials'] {
    const now = this.store.now();
    return { accessToken: data.access_token, accessExpires: now + (data.expires_in ? data.expires_in * 1000 : 30 * DAY),
      refreshToken: data.refresh_token || null, refreshExpires: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : 0 };
  }
  async prepare(input: C.Input<'authPrepare'>): Promise<{ attempt: string; authorizeURL: string }> {
    const request = input.request;
    const origin = parentOrigin(this.policy, request.origin);
    const openerOrigin = request.openerOrigin || this.config.origin;
    requireCondition(openerOrigin === this.config.origin || openerOrigin === origin, 403, 'ORIGIN', 'The sign-in opener must be the service or authorized page.');
    const attempt = await hash(request.proof), githubVerifier = random(), now = this.store.now();
    return this.store.lock('auth:' + attempt, () => this.store.lock('session:' + request.proof, async () => {
    requireCondition(!this.store.get('session:' + request.proof, S.EncryptedRecord), 409, 'OAUTH', 'This session already exists. Start a new sign-in.');
    requireCondition(!this.store.get('auth:' + attempt, S.EncryptedRecord), 409, 'OAUTH', 'This sign-in is already being prepared. Start again.');
    const url = new URL(request.origin); url.hash = ''; url.searchParams.delete('giscus');
    const record: S.OAuthAttempt = { origin, returnURL: url.toString(), mode: request.mode, openerOrigin,
      sessionID: request.proof, githubVerifier, cookieHash: await hash(input.browserCookie), created: now, expires: now + TEN_MINUTES,
      status: 'pending' };
    await this.store.putSecret('auth:' + attempt, S.OAuthAttempt, record, this.keys.sessionSecret, this.#purpose, record.expires);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.origin + '/auth/callback', state: stateValue(this.repo, attempt), code_challenge: await hash(githubVerifier), code_challenge_method: 'S256' }).toString();
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
  async callback(input: C.Input<'authCallback'>): Promise<CallbackResult> {
    return this.store.lock('auth:' + input.attempt, async () => {
      const attempt = await this.#attempt(input.attempt);
      requireCondition(attempt, 401, 'OAUTH', 'This sign-in attempt expired or was already used. Start again.');
      requireCondition(input.browserCookie && equal(await hash(input.browserCookie), attempt.cookieHash), 401, 'OAUTH', 'Sign-in must finish in the browser that started it.');
      requireCondition(attempt.status === 'pending', 409, 'OAUTH', 'This sign-in callback was already used.');
      const view = (status: 'ready' | 'denied'): CallbackResult => ({ status, attempt: input.attempt, repo: this.repo, returnURL: attempt.returnURL, mode: attempt.mode, openerOrigin: attempt.openerOrigin || this.config.origin });
      if (input.denied) { this.store.delete('auth:' + input.attempt); return view('denied'); }
      requireCondition(input.code, 400, 'OAUTH', 'GitHub did not return an authorization code.');
      attempt.status = 'exchanging'; await this.#saveAttempt(input.attempt, attempt);
      try {
        const token = await this.github.exchange({ code: input.code, code_verifier: attempt.githubVerifier, redirect_uri: this.config.origin + '/auth/callback' });
        const principal = await this.github.principal(token.access_token), fields = this.#fields(token);
        const session = { principal, credentials: fields, origin: attempt.origin,
          expires: Math.min(this.store.now() + 30 * DAY, fields.refreshToken ? fields.refreshExpires : fields.accessExpires) };
        await this.store.lock('session:' + attempt.sessionID, async () => {
          requireCondition(attempt.expires > this.store.now(), 401, 'OAUTH', 'This sign-in expired. Start again.');
          requireCondition(!this.store.get('session:' + attempt.sessionID, S.EncryptedRecord), 409, 'OAUTH', 'This session already exists. Start a new sign-in.');
          await this.store.consumeSecret('auth:' + input.attempt, 'session:' + attempt.sessionID, S.Session, session, this.keys.sessionSecret, this.#purpose, session.expires);
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
  async session(capability: string, page: string, required: boolean): Promise<S.Session | null> {
    if (!capability) { requireCondition(!required, 401, 'AUTH_REQUIRED', 'Sign in with GitHub to continue.'); return null; }
    const origin = parentOrigin(this.policy, page), key = 'session:' + await hash(capability);
    return this.store.lock(key, async () => {
      let data = await this.#storedSession(key, origin);
      if (data.credentials.accessExpires <= this.store.now() + 60000) {
        if (!data.credentials.refreshToken || data.credentials.refreshExpires <= this.store.now()) { this.store.delete(key); throw new AppError(401, 'SESSION', 'Your GitHub authorization expired. Sign in again.'); }
        // Retire the rotating credentials durably before the external exchange.
        // If execution stops after GitHub rotates them, the next request must
        // reauthenticate rather than replay an already consumed refresh token.
        this.store.delete(key);
        try {
          const refreshed = await this.github.exchange({ grant_type: 'refresh_token', refresh_token: data.credentials.refreshToken });
          requireCondition(refreshed.refresh_token && refreshed.refresh_token_expires_in, 502, 'UPSTREAM_SCHEMA', 'GitHub did not return a complete refreshed session. Sign in again.');
          data = { ...data, credentials: this.#fields(refreshed) };
          await this.store.putSecret(key, S.Session, data, this.keys.sessionSecret, this.#purpose, data.expires);
        } catch (error) {
          // An uncertain rotating refresh can make the old refresh token unusable.
          // A failed or interrupted exchange requires a new sign-in.
          this.store.delete(key);
          throw new AppError(401, 'SESSION', 'Your GitHub session could not be renewed. Sign in again.');
        }
      }
      return data;
    });
  }
  async logout(capability: string, origin: string): Promise<{ ok: true }> {
    const allowedOrigin = parentOrigin(this.policy, origin);
    if (capability) {
      const key = 'session:' + await hash(capability);
      await this.store.lock(key, async () => {
        await this.#storedSession(key, allowedOrigin);
        this.store.delete(key);
      });
    }
    return { ok: true };
  }
}
