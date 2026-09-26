import type { StandardSchemaV1 } from '@standard-schema/spec';
import { validator } from 'hono/validator';
import type { MiddlewareHandler } from 'hono';
import * as v from 'valibot';
import { AppError, requireCondition } from '../domain/errors.js';
import { hash } from '../domain/crypto.js';
import { parse } from '../contracts/parse.js';
import { Capability } from '../contracts/primitives.js';
import type { AppEnv } from './types.js';

/** Reuse the bounded JSON read in Hono's validator. */
export const boundedJSON: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireCondition(c.req.method === 'POST', 405, 'METHOD', 'Use POST for API operations.');
  requireCondition(c.req.header('Origin') === c.get('config').origin, 403, 'ORIGIN', 'The request must originate at the comments service.');
  const site = c.req.header('Sec-Fetch-Site');
  requireCondition(!site || site === 'same-origin', 403, 'ORIGIN', 'Cross-site API calls are not accepted.');
  const type = (c.req.header('Content-Type') || '').split(';')[0]?.trim().toLowerCase();
  requireCondition(type === 'application/json', 415, 'MEDIA_TYPE', 'Use application/json.');
  const max = 96 * 1024, declared = c.req.header('Content-Length');
  if (declared) requireCondition(/^\d+$/.test(declared) && Number(declared) <= max, 413, 'BODY_TOO_LARGE', 'Request body is too large.');
  const reader = c.req.raw.body?.getReader();
  requireCondition(reader, 400, 'BAD_INPUT', 'A JSON body is required.');
  const chunks: Uint8Array[] = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length; requireCondition(count <= max, 413, 'BODY_TOO_LARGE', 'Request body is too large.'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new AppError(400, 'BAD_INPUT', 'The request body is not valid JSON.'); }
  c.req.bodyCache.json = Promise.resolve(value);
  const header = c.req.header('Authorization');
  if (header) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    requireCondition(match?.[1], 401, 'SESSION', 'Your session token is invalid. Sign in again.');
    c.set('session', parse(Capability, match[1]));
  } else c.set('session', '');
  await next();
};

/** Validate route input through Standard Schema v1. */
export function contract<S extends StandardSchemaV1>(schema: S) {
  return validator('json', async (input: unknown) => {
    const result = await schema['~standard'].validate(input);
    if (result.issues !== undefined) throw new AppError(400, 'BAD_INPUT', 'The request contains missing or invalid fields.');
    return result.value as StandardSchemaV1.InferOutput<S>;
  });
}
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
