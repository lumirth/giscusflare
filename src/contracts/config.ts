import * as v from 'valibot';
import { CategoryName, EmptyNodeID, Order, Origin, RepositoryName, Token } from './primitives.js';
import { parse, parseJSON } from './parse.js';
export const RepositoryPolicy = v.strictObject({
  origins: v.pipe(v.array(Origin), v.minLength(1), v.maxLength(30)),
  category: CategoryName,
  categoryId: v.optional(EmptyNodeID, ''),
  maxReplyPrefetch: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)), 20),
  defaultCommentOrder: v.optional(Order, 'oldest'),
  customThemeOrigins: v.optional(v.pipe(v.array(Origin), v.maxLength(20)), []),
});
export const RepositoryPolicies = v.pipe(v.record(v.pipe(v.string(), v.regex(/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9_.-]{1,100}$/), v.check(s => !s.endsWith('/.') && !s.endsWith('/..'))), RepositoryPolicy),
  v.check(p => Object.keys(p).length > 0 && Object.keys(p).length <= 100),
  v.check(p => Object.keys(p).every(k => k === k.toLowerCase())));
export const PublicConfig = v.strictObject({
  origin: Origin,
  appId: v.pipe(v.string(), v.regex(/^[1-9]\d{0,18}$/)),
  clientId: v.pipe(v.string(), v.minLength(3), v.maxLength(100), v.regex(/^[A-Za-z0-9_.-]+$/)),
  repositories: RepositoryPolicies,
});
export const SecretConfig = v.strictObject({
  clientSecret: Token,
  privateKey: v.pipe(v.string(), v.minLength(100), v.maxLength(16000)),
  sessionSecret: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
});
export type RepositoryPolicy = v.InferOutput<typeof RepositoryPolicy>;
export type PublicConfig = v.InferOutput<typeof PublicConfig>;
export type SecretConfig = v.InferOutput<typeof SecretConfig>;
export interface ConfigBindings { PUBLIC_ORIGIN: string; GITHUB_APP_ID: string; GITHUB_CLIENT_ID: string; REPOSITORIES: unknown; GITHUB_CLIENT_SECRET: string; GITHUB_PRIVATE_KEY: string; SESSION_SECRET: string }
const cache = new WeakMap<object, PublicConfig>();
export function configuration(env: ConfigBindings): PublicConfig {
  // Cache the parsed deployment settings, not pending requests.
  const cached = cache.get(env); if (cached) return cached;
  const repositories = typeof env.REPOSITORIES === 'string' ? parseJSON(env.REPOSITORIES, 'config') : env.REPOSITORIES;
  const config = parse(PublicConfig, { origin: env.PUBLIC_ORIGIN, appId: env.GITHUB_APP_ID, clientId: env.GITHUB_CLIENT_ID, repositories }, 'config');
  cache.set(env, config); return config;
}
export function secrets(env: ConfigBindings): SecretConfig {
  return parse(SecretConfig, { clientSecret: env.GITHUB_CLIENT_SECRET, privateKey: env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n'), sessionSecret: env.SESSION_SECRET }, 'config');
}
