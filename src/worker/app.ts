import type { ReadValue } from '../contracts/results.js';
import * as v from 'valibot';
import {encrypt,decrypt,hash} from '../domain/crypto.js';
import {registerRepository} from '../domain/github.js';
import type {Registration} from '../domain/repository.js';
import {ContentBatch,ContentSource} from '../contracts/content.js';
import {NodeID,PositiveInteger,RepositoryName,Origin,CategoryName} from '../contracts/primitives.js';
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
import { version } from '../../package.json';
import {API_PREFIX} from '../contracts/protocol.js';

const RegistrationRecord=v.strictObject({repo:RepositoryName,repositoryId:NodeID,installationId:PositiveInteger,categoryId:NodeID,policy:v.string()});
async function registration(env:Env,repo:string,reference?:string):Promise<Registration>{
  const config=configuration(env),known=config.repositories[repo];if(known)return {repositoryId:known.repositoryId,installationId:known.installationId,categoryId:known.categoryId};
  requireCondition(config.openHosting&&reference,403,'PERMISSION','Register this public repository before using the service.');
  let record:v.InferOutput<typeof RegistrationRecord>;
  try{record=await decrypt(RegistrationRecord,reference,secrets(env).sessionSecret,'registration:'+config.appId);}catch{throw new AppError(403,'PERMISSION','This registration is invalid. Register again.');}
  requireCondition(record.repo===repo&&record.policy===await hash(JSON.stringify(config.openHosting)),403,'PERMISSION','This registration does not match the current hosting policy.');return record;
}
async function invoke<K extends C.Operation>(env:Env,name:K,input:C.Input<K>,authority:C.Authority={}){
  const request=input as C.Input<C.Operation>,context='config'in request?request.config:request;
  const repo=context.repo,config=configuration(env);const resolved=await registration(env,repo,'registration'in context?context.registration:undefined);
  return env.REPOSITORY_STORE.get(env.REPOSITORY_STORE.idFromName(`v3:${config.appId}:${resolved.repositoryId}`)).execute(name,input,resolved,authority);
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
const operationRates=new Map(Object.values(C.operations).map(operation => [operation.path, operation.rate]));
operationRates.set(API_PREFIX+'/content','read');
operationRates.set(API_PREFIX+'/registration','auth');
const requireSession = (value: string): string => { requireCondition(value, 401, 'AUTH_REQUIRED', 'Sign in with GitHub to continue.'); return value; };
app.onError((error, c) => {
  const safe = failure(error), id = crypto.randomUUID();
  if (!(error instanceof AppError)) console.error(JSON.stringify({ event: 'internal_error', id }));
  return security(json({ error: safe, requestId: id }, safe.status, safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {}));
});
app.get(API_PREFIX+'/setup',c=>{
  let configured=false;
  try{configuration(c.env);secrets(c.env);configured=true;}catch{/* First deployment opens setup. */}
  return security(json({configured,origin:new URL(c.req.url).origin}));
});
app.get('/healthz',c=>security(json({status:'ok',version})));
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
  const input = parse(R.WidgetQuery, query), p = authorizePresentation(configuration(env),input);
  const response=await publicRead(c,{config:input},async()=>unwrap(await invoke(env,'page',{config:R.selection(input),read:{kind:'roots',order:p.defaultCommentOrder,cursor:'',replyPrefetch:5},fresh:false,providerHTML:true})),(view,expires)=>widgetHTML(input,p,{view,expires}));
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
  const result = unwrap(await invoke(c.env,'authCallback', {...state,code:query.code||'',denied:Boolean(query.error)},{browserCookie:cookie(c.req.raw,cookieName(c.get('config').origin,state.attempt))}));
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
    requireCondition(origin && ['GET','POST'].includes(c.req.header('Access-Control-Request-Method')||'') && c.req.path !== C.operations.authPrepare.path, 403, 'ORIGIN', 'This operation does not support native requests.');
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
app.use(API_PREFIX+'/*', async (c, next) => {
  await rateLimit(operationRates.get(c.req.path) || 'write')(c, next);
});
app.use(API_PREFIX+'/*', boundedJSON);
app.use(API_PREFIX+'/*', async (c, next) => { await next(); c.res = security(c.res); });
for (const name of Object.keys(C.operations) as (keyof typeof C.operations)[]) {
  if(name==='authPrepare'||name==='authCallback') continue;
  const operation = C.operations[name];
  const methods='methods'in operation?operation.methods:[operation.method];
  for(const method of methods)app[method](operation.path,async c=>{
    const request=parse(operation.request,c.get('input'));
    const run = async () => {
      const session = operation.authenticated ? requireSession(c.get('session')) : c.get('session');
      return unwrap(await invoke(c.env,name,request as C.Input<typeof name>,{session}));
    };
    if (operation.cache) return publicRead(c, request, run as () => Promise<ReadValue<unknown>>);
    if('config'in request)authorizeWidget(c.get('config'),request.config);else if('origin'in request)parentOrigin(policy(c.get('config'),request.repo),request.origin);
    return json(await run());
  });
}
app.post(API_PREFIX+'/registration',async c=>{
  const raw=parse(v.object({repo:RepositoryName,origin:Origin,category:CategoryName}),c.get('input')),config=c.get('config');
  const local=c.req.header('Origin')===config.origin;
  requireCondition(local||config.openHosting,403,'PERMISSION','Open repository registration is disabled.');
  if(!local){parentOrigin(policy(config,raw.repo),raw.origin);requireCondition(raw.category===config.openHosting?.category,403,'CATEGORY','Use the hosting category.');}
  const resolved=await registerRepository(raw.repo,raw.category,config,secrets(c.env));
  const reference=config.openHosting&&raw.category===config.openHosting.category?await encrypt({...resolved,repo:raw.repo,policy:await hash(JSON.stringify(config.openHosting))},secrets(c.env).sessionSecret,'registration:'+config.appId):undefined;
  return json({...resolved,...(reference?{registration:reference}:{})});
});
app.post(API_PREFIX+'/content',async c=>{
  const raw=parse(v.object({config:R.Selection,content:v.optional(ContentSource,'prepared'),...ContentBatch.entries}),c.get('input'));
  authorizeWidget(c.get('config'),raw.config);
  for(const input of raw.inputs)requireCondition(input.repo===raw.config.repo&&input.pageURL===raw.config.pageURL,403,'ORIGIN','Content must belong to the selected page.');
  const missing=raw.inputs.filter(input=>['github','stock'].includes(raw.content)&&!input.html);
  const interpreted=missing.length?unwrap(await invoke(c.env,'interpret',{config:raw.config,inputs:missing})):{results:[]};
  let cursor=0;const prepared=raw.inputs.map(input=>{
    if(!missing.includes(input))return {input};
    const result=interpreted.results[cursor++];
    return result&&'error'in result?{input,error:result.error}:{input:{...input,html:result?.html}};
  });
  if(raw.content==='github')return json({results:prepared.map(value=>value.error?{error:value.error}:{html:value.input.html})});
  requireCondition(c.env.CONTENT,503,'CONFIGURATION','This service needs a content profile binding.');
  const successful=prepared.filter(value=>!value.error);
  let rendered:{results:Record<string,unknown>[] }={results:[]};
  if(successful.length){const response=await c.env.CONTENT.fetch(new Request('https://content.internal/',{method:'POST',signal:c.req.raw.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({inputs:successful.map(value=>value.input)})}));if(!response.ok)return response;rendered=await response.json() as typeof rendered;}
  let index=0;const results=prepared.map(value=>{if(value.error)return {error:value.error};const result=rendered.results[index++]!;return result;});
  return json({results});
});
app.post(C.operations.authPrepare.path, async c => {
  const request=parse(C.operations.authPrepare.request,c.get('input')),browserCookie=random();parentOrigin(policy(c.get('config'),request.repo),request.origin);
  const result = unwrap(await invoke(c.env,'authPrepare',request,{browserCookie}));
  return json(result, 200, { 'Set-Cookie': cookieHeader(c.get('config').origin, result.attempt, browserCookie) });
});
app.all(API_PREFIX+'/*', () => { throw new AppError(404, 'NOT_FOUND', 'API route not found.'); });
app.all('/api/*', () => { throw new AppError(409, 'VERSION_MISMATCH', 'This comments page needs an update. Reload the page and try again.'); });
app.all('/auth/*', () => { throw new AppError(404, 'NOT_FOUND', 'Sign-in route not found.'); });
app.all('*', c => {
  requireCondition(['GET', 'HEAD'].includes(c.req.method), 405, 'METHOD', 'This route only accepts GET or HEAD.');
  return c.env.ASSETS.fetch(c.req.raw);
});
