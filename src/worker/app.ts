import { Hono } from 'hono';
import { configuration } from '../contracts/config.js';
import { parse } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import { authorizeWidget, parentOrigin, policy } from '../domain/authorization.js';
import { cookieName, stateParts } from '../domain/auth.js';
import { random } from '../domain/crypto.js';
import { AppError, failure, requireCondition, unwrap } from '../domain/errors.js';
import { boundedJSON, contract, rateLimit } from './middleware.js';
import { authHTML, json, security, widgetHTML } from './html.js';
import type { AppEnv, Env } from './types.js';

function repository(env: Env, repo: string) {
  const config = configuration(env); policy(config, repo);
  return env.REPOSITORY_STORE.get(env.REPOSITORY_STORE.idFromName(`v2:${config.appId}:${repo}`));
}
function cookie(request: Request, name: string): string {
  const matches = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  if (matches.length !== 1) return '';
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function cookieHeader(origin: string, attempt: string, value: string, clear = false): string {
  return `${cookieName(origin, attempt)}=${value}; Path=/; Max-Age=${clear ? 0 : 600}; HttpOnly; SameSite=Lax${origin.startsWith('https:') ? '; Secure' : ''}`;
}
export const app = new Hono<AppEnv>();
app.onError((error, c) => {
  const safe = failure(error), id = crypto.randomUUID();
  if (!(error instanceof AppError)) console.error(JSON.stringify({ event: 'internal_error', id }));
  return security(json({ error: safe, requestId: id }, safe.status, safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {}));
});
app.use('*', async (c, next) => {
  const config = configuration(c.env); c.set('config', config);
  const url = new URL(c.req.url);
  requireCondition(url.origin === config.origin, 403, 'ORIGIN', 'This address does not match PUBLIC_ORIGIN.');
  requireCondition(c.req.url.length <= 8192, 414, 'BAD_INPUT', 'The request URL is too long.');
  await next();
});
app.get('/healthz', c => security(json({ status: 'ok', version: '0.1.0-dev' })));
const widget = (rawURL: string, env: Env, pathLang?: string) => {
  const url = new URL(rawURL), query = R.queryObject(url);
  if (pathLang) { requireCondition(!query.lang || query.lang === pathLang, 400, 'BAD_INPUT', 'The path and query specify different languages.'); query.lang = pathLang; }
  const input = parse(R.WidgetQuery, query), p = authorizeWidget(configuration(env), input);
  return widgetHTML(input, p);
};
app.get('/widget', rateLimit('read'), c => widget(c.req.url, c.env));
app.get('/:lang/widget', rateLimit('read'), c => widget(c.req.url, c.env, c.req.param('lang')));
app.get('/auth/window', rateLimit('auth'), c => {
  const input = parse(R.AuthPrepare, R.queryObject(new URL(c.req.url)));
  const p = policy(c.get('config'), input.repo); parentOrigin(p, input.origin);
  return security(authHTML('Opening GitHub…', '/auth-window.js', input));
});
app.get('/auth/callback', rateLimit('auth'), async c => {
  const query = parse(R.AuthCallbackQuery, R.queryObject(new URL(c.req.url))), state = stateParts(query.state);
  policy(c.get('config'), state.repo);
  const result = unwrap(await repository(c.env, state.repo).authCallback({ ...state, browserCookie: cookie(c.req.raw, cookieName(c.get('config').origin, state.attempt)), code: query.code || '', denied: Boolean(query.error) }));
  const response = authHTML('Returning to comments…', '/auth-complete.js', result);
  response.headers.append('Set-Cookie', cookieHeader(c.get('config').origin, state.attempt, '', true));
  return security(response);
});
// Native consumers authenticate with explicit bearer capabilities. CORS never
// grants credentialed-cookie access; the body gate checks repository scope.
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin'), config = c.get('config');
  const native = Boolean(origin && origin !== config.origin);
  if (native) requireCondition(Object.values(config.repositories).some(p => p.origins.includes(origin!)), 403, 'ORIGIN', 'This website is not allowed.');
  if (c.req.method === 'OPTIONS') {
    requireCondition(origin && c.req.header('Access-Control-Request-Method') === 'POST' && c.req.path !== '/api/auth/prepare', 403, 'ORIGIN', 'This operation does not support native requests.');
    c.res = new Response(null, { status: 204 });
  } else await next();
  // Apply after the security wrapper creates its response, including errors.
  if (native) {
    c.res.headers.set('Access-Control-Allow-Origin', origin!);
    c.res.headers.set('Vary', 'Origin');
    c.res.headers.set('Access-Control-Allow-Methods', 'POST');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.res.headers.set('Access-Control-Max-Age', '600');
  }
});
app.use('/api/*', async (c, next) => {
  const auth = c.req.path === '/api/auth/prepare';
  const read = ['/api/counts', '/api/config', '/api/thread', '/api/replies', '/api/auth/poll'].includes(c.req.path);
  await rateLimit(auth ? 'auth' : read ? 'read' : 'write')(c, next);
});
app.use('/api/*', boundedJSON);
app.use('/api/*', async (c, next) => { await next(); c.res = security(c.res); });
app.post('/api/config', contract(R.InfoRequest), async c => {
  const input = c.req.valid('json'); return json(unwrap(await repository(c.env, input.repo).info(input)));
});
app.post('/api/counts', contract(R.CountsRequest), async c => {
  const input = c.req.valid('json'); return json(unwrap(await repository(c.env, input.repo).counts(input)));
});
app.post('/api/thread', contract(R.ThreadRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).thread({ request, session: c.get('session') })));
});
app.post('/api/replies', contract(R.RepliesRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).replies({ request, session: c.get('session') })));
});
const requireSession = (value: string): string => { requireCondition(value, 401, 'AUTH_REQUIRED', 'Sign in with GitHub to continue.'); return value; };
app.post('/api/comment', contract(R.CommentRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).comment({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/edit', contract(R.EditRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).edit({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/delete', contract(R.DeleteRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).remove({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/reaction', contract(R.ReactionRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).reaction({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/moderate', contract(R.ModerateRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).moderate({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/discussion',contract(R.DiscussionActionRequest),async c=>json(unwrap(await repository(c.env,c.req.valid('json').config.repo).discussionAction({request:c.req.valid('json'),session:requireSession(c.get('session'))}))));
app.post('/api/block',contract(R.BlockRequest),async c=>json(unwrap(await repository(c.env,c.req.valid('json').config.repo).block({request:c.req.valid('json'),session:requireSession(c.get('session'))}))));
app.post('/api/preview', contract(R.PreviewRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.config.repo).preview({ request, session: requireSession(c.get('session')) })));
});
app.post('/api/auth/prepare', contract(R.AuthPrepare), async c => {
  const request = c.req.valid('json'), browserCookie = random();
  const result = unwrap(await repository(c.env, request.repo).authPrepare({ request, browserCookie }));
  return json(result, 200, { 'Set-Cookie': cookieHeader(c.get('config').origin, result.attempt, browserCookie) });
});
app.post('/api/auth/poll', contract(R.AuthProof), async c => {
  const input = c.req.valid('json'); return json(unwrap(await repository(c.env, input.repo).authPoll(input)));
});
app.post('/api/auth/consume', contract(R.AuthConsume), async c => {
  const input = c.req.valid('json'); return json(unwrap(await repository(c.env, input.repo).authConsume(input)));
});
app.post('/api/logout', contract(R.LogoutRequest), async c => {
  const request = c.req.valid('json'); return json(unwrap(await repository(c.env, request.repo).logout({ request, session: requireSession(c.get('session')) })));
});
app.all('/api/*', () => { throw new AppError(404, 'NOT_FOUND', 'API route not found.'); });
app.all('/auth/*', () => { throw new AppError(404, 'NOT_FOUND', 'Sign-in route not found.'); });
app.all('*', c => {
  requireCondition(['GET', 'HEAD'].includes(c.req.method), 405, 'METHOD', 'This route only accepts GET or HEAD.');
  return c.env.ASSETS.fetch(c.req.raw);
});
