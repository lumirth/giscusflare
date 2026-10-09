import type { ReadValue } from '../contracts/results.js';
import { admitRepository } from './admission.js';
import { publicRead } from './public-read.js';
import { Hono } from 'hono';
import * as C from '../contracts/rpc.js';
import { configuration, secrets } from '../contracts/config.js';
import { parse } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import { authorizePresentation, authorizeWidget, parentOrigin, policy } from '../domain/authorization.js';
import { cookieName, stateParts } from '../domain/auth.js';
import { random } from '../domain/crypto.js';
import { AppError, failure, requireCondition, unwrap } from '../domain/errors.js';
import { boundedJSON, rateLimit } from './middleware.js';
import { authHTML, json, security, widgetHTML } from './html.js';
import type { AppEnv, Env } from './types.js';

async function invoke<K extends C.Operation>(env: Env, name: K, input: C.Input<K>) {
  const call = input as C.Input<C.Operation>;
  const request = 'request' in call ? call.request : call;
  const repo = 'config' in request ? request.config.repo : request.repo;
  const config = configuration(env);
  policy(config, repo);
  const identity = await admitRepository(env, repo);
  const object = env.REPOSITORY_STORE.get(env.REPOSITORY_STORE.idFromName(`v3:${config.appId}:${identity}`));
  return object.execute(name, input, identity);
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
const operationRates = new Map(Object.values(C.operations).map(operation => [operation.path, operation.rate]));
const requireSession = (value: string): string => { requireCondition(value, 401, 'AUTH_REQUIRED', 'Sign in with GitHub to continue.'); return value; };
app.onError((error, c) => {
  const safe = failure(error), id = crypto.randomUUID();
  if (!(error instanceof AppError)) console.error(JSON.stringify({ event: 'internal_error', id }));
  return security(json({ error: safe, requestId: id }, safe.status, safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {}));
});
app.get('/api/v5/setup',c=>{
  let configured=false;
  try{configuration(c.env);secrets(c.env);configured=true;}catch{/* First deployment opens setup. */}
  return security(json({configured,origin:new URL(c.req.url).origin}));
});
app.get('/healthz',c=>security(json({status:'ok',version:'5.0.1'})));
app.use('*', async (c, next) => {
  if(!/^\/(?:api\/|auth\/|(?:[a-z-]+\/)?widget(?:$|\/))/.test(c.req.path)){await next();return;}
  const config = configuration(c.env); c.set('config', config);
  const url = new URL(c.req.url);
  requireCondition(url.origin === config.origin, 403, 'ORIGIN', 'This address does not match PUBLIC_ORIGIN.');
  requireCondition(c.req.url.length <= 8192, 414, 'BAD_INPUT', 'The request URL is too long.');
  await next();
});
const widget = async (c:import('hono').Context<AppEnv>, pathLang?: string) => {
  const rawURL=c.req.url,env=c.env;
  const url = new URL(rawURL), query = R.queryObject(url);
  if (pathLang) { requireCondition(!query.lang || query.lang === pathLang, 400, 'BAD_INPUT', 'The path and query specify different languages.'); query.lang = pathLang; }
  const input = parse(R.WidgetQuery, query), p = authorizeWidget(configuration(env), input);
  authorizePresentation(configuration(env),input);
  const response=await publicRead(c,{config:input},async()=>unwrap(await invoke(env,'page',{request:parse(R.PageRequest,{config:R.selection(input),order:p.defaultCommentOrder,content:'github'}),session:''})),(view,expires)=>widgetHTML(input,p,{view,expires}));
  response.headers.set('Cache-Control','no-store');return response;
};
app.get('/widget', rateLimit('read'), c => widget(c));
app.get('/:lang/widget', rateLimit('read'), c => widget(c,c.req.param('lang')));
app.get('/auth/window', rateLimit('auth'), c => {
  const input = parse(R.AuthWindow, R.queryObject(new URL(c.req.url)));
  const p = policy(c.get('config'), input.repo); parentOrigin(p, input.origin);
  return security(authHTML('Opening GitHub…', '/auth-window.js', input));
});
app.get(C.operations.authCallback.path, rateLimit('auth'), async c => {
  const query = parse(C.operations.authCallback.request, R.queryObject(new URL(c.req.url))), state = stateParts(query.state);
  policy(c.get('config'), state.repo);
  const result = unwrap(await invoke(c.env,'authCallback', { ...state, browserCookie: cookie(c.req.raw, cookieName(c.get('config').origin, state.attempt)), code: query.code || '', denied: Boolean(query.error) }));
  const response = authHTML('Returning to comments…', '/auth-complete.js', result);
  response.headers.append('Set-Cookie', cookieHeader(c.get('config').origin, state.attempt, '', true));
  return security(response);
});
// Native consumers authenticate with explicit bearer capabilities. CORS never
// grants credentialed-cookie access; the body gate checks repository scope.
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin'), config = c.get('config');
  const native = Boolean(origin && origin !== config.origin);
  if (native) requireCondition([...Object.values(config.repositories),...(config.openHosting?[config.openHosting]:[])].some(p=>p.origins==='*'||p.origins.includes(origin!)), 403, 'ORIGIN', 'This website is not allowed.');
  if (c.req.method === 'OPTIONS') {
    requireCondition(origin && ['GET','POST'].includes(c.req.header('Access-Control-Request-Method')||'') && c.req.path !== '/api/v5/auth/prepare', 403, 'ORIGIN', 'This operation does not support native requests.');
    c.res = new Response(null, { status: 204 });
  } else await next();
  // Apply after the security wrapper creates its response, including errors.
  if (native) {
    c.res.headers.set('Access-Control-Allow-Origin', origin!);
    c.res.headers.set('Vary', 'Origin');
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.res.headers.set('Access-Control-Max-Age', '600');
  }
});
app.use('/api/v5/*', async (c, next) => {
  await rateLimit(operationRates.get(c.req.path) || 'write')(c, next);
});
app.use('/api/v5/*', boundedJSON);
app.use('/api/v5/*', async (c, next) => { await next(); c.res = security(c.res); });
for (const name of Object.keys(C.operations) as C.Operation[]) {
  if (name === 'authPrepare' || name === 'authCallback') continue;
  const operation = C.operations[name];
  app[operation.method](operation.path, async c => {
    const request = parse(operation.request, c.get('input')), repo = 'config' in request ? request.config.repo : request.repo;
    const run = async () => {
      const session = operation.authenticated ? requireSession(c.get('session')) : c.get('session');
      const input = operation.envelope === 'direct' ? request : { request, session };
      return unwrap(await invoke(c.env, name, input as C.Input<typeof name>));
    };
    if (operation.cache) return publicRead(c, request, run as () => Promise<ReadValue<unknown>>);
    if ('config' in request) authorizeWidget(c.get('config'), request.config);
    return json(await run());
  });
}
app.post(C.operations.authPrepare.path, async c => {
  const request = parse(C.operations.authPrepare.request, c.get('input')), browserCookie = random();
  const result = unwrap(await invoke(c.env,'authPrepare', { request, browserCookie }));
  return json(result, 200, { 'Set-Cookie': cookieHeader(c.get('config').origin, result.attempt, browserCookie) });
});
app.all('/api/v5/*', () => { throw new AppError(404, 'NOT_FOUND', 'API route not found.'); });
app.all('/api/*', () => { throw new AppError(409, 'VERSION_MISMATCH', 'This comments page needs an update. Reload the page and try again.'); });
app.all('/auth/*', () => { throw new AppError(404, 'NOT_FOUND', 'Sign-in route not found.'); });
app.all('*', c => {
  requireCondition(['GET', 'HEAD'].includes(c.req.method), 405, 'METHOD', 'This route only accepts GET or HEAD.');
  return c.env.ASSETS.fetch(c.req.raw);
});
