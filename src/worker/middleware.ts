import type { MiddlewareHandler } from 'hono';
import * as v from 'valibot';
import { AppError, requireCondition } from '../domain/errors.js';
import { hash } from '../domain/crypto.js';
import { parse } from '../contracts/parse.js';
import { Capability } from '../contracts/primitives.js';
import type { AppEnv } from './types.js';
import { bodyBytes } from '../domain/body.js';

/** Read untrusted transport input once, before scope and schema validation. */
export const boundedJSON: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireCondition(['GET','POST'].includes(c.req.method),405,'METHOD','Use GET to read or POST to write.');
  const origin = c.req.header('Origin') || (c.req.method==='GET'?new URL(c.req.url).origin:undefined);
  const native = origin !== c.get('config').origin;
  requireCondition(origin && (!native || c.req.path !== '/api/v3/auth/prepare'), 403, 'ORIGIN', 'This operation must originate at the comments service.');
  const site = c.req.header('Sec-Fetch-Site');
  requireCondition(native || !site || site === 'same-origin', 403, 'ORIGIN', 'Invalid service request origin.');
  let value:unknown;
  if(c.req.method==='GET'){
    const url=new URL(c.req.url);
    requireCondition(url.searchParams.size===1&&url.searchParams.has('input'),400,'BAD_INPUT','A read input is required.');
    try{value=JSON.parse(url.searchParams.get('input')!);}catch{throw new AppError(400,'BAD_INPUT','Invalid read input.');}
  }else{
  const type = (c.req.header('Content-Type') || '').split(';')[0]?.trim().toLowerCase();
  requireCondition(type === 'application/json', 415, 'MEDIA_TYPE', 'Use application/json.');
  const max = 96 * 1024, declared = c.req.header('Content-Length');
  if (declared) requireCondition(/^\d+$/.test(declared) && Number(declared) <= max, 413, 'BODY_TOO_LARGE', 'Request body is too large.');
  const bytes = await bodyBytes(c.req.raw.body, max, new AppError(400, 'BAD_INPUT', 'A JSON body is required.'), new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; }
  catch { throw new AppError(400, 'BAD_INPUT', 'The request body is not valid JSON.'); }
  }
  if (native) {
    // Preflight permits known hosts; the actual request also binds that host to
    // this repository and the page in the request. No ambient cookie authority.
    const scope = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const raw = scope.config && typeof scope.config === 'object' ? scope.config as Record<string, unknown> : scope;
    const repositories = c.get('config').repositories;
    requireCondition(typeof raw.repo === 'string' && typeof raw.origin === 'string', 403, 'ORIGIN', 'A page and repository are required.');
    const repoPolicy = Object.hasOwn(repositories,raw.repo)?repositories[raw.repo]:c.get('config').openHosting;
    let pageOrigin = ''; try { pageOrigin = new URL(raw.origin).origin; } catch { /* rejected below */ }
    requireCondition((repoPolicy?.origins==='*'||repoPolicy?.origins.includes(origin)) && pageOrigin === origin, 403, 'ORIGIN', 'This page is not allowed to use this repository.');
  }
  c.set('input', value);
  const header = c.req.header('Authorization');
  if (header) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    requireCondition(match?.[1], 401, 'SESSION', 'Your session token is invalid. Sign in again.');
    c.set('session', parse(Capability, match[1]));
  } else c.set('session', '');
  await next();
};

const LimitResult = v.object({ success: v.boolean() });
export function rateLimit(kind: 'read' | 'write' | 'auth'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const binding = kind === 'auth' ? c.env.AUTH_LIMITER : kind === 'write' ? c.env.WRITE_LIMITER : c.env.READ_LIMITER;
    requireCondition(binding && typeof binding.limit === 'function', 503, 'CONFIGURATION', 'The native rate-limiter binding is not configured.');
    // Cloudflare sets this header. Local callers share the fallback bucket.
    const ip = c.req.header('CF-Connecting-IP') || 'local';
    const key = await hash(c.get('config').appId + ':' + kind + ':' + ip);
    let success: boolean;
    try { success = parse(LimitResult, await binding.limit({ key }), 'config').success; }
    catch { throw new AppError(503, 'CONFIGURATION', 'The rate limiter is temporarily unavailable.'); }
    if (!success) throw new AppError(429, 'RATE_LIMIT', 'Too many requests. Try again in a minute.', 60);
    await next();
  };
}
