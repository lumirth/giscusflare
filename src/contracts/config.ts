import * as v from 'valibot';
import {INPUTS,DEFAULT_RANKING_LIMITS} from '../ranking/types.js';
import { CategoryName, EmptyNodeID, Order, Origin, RepositoryName, Token } from './primitives.js';
import { parse, parseJSON } from './parse.js';
const RankingProfile=v.strictObject({
  weights:v.pipe(v.record(v.picklist(INPUTS),v.pipe(v.number(),v.finite(),v.minValue(-1000000),v.maxValue(1000000))),v.check(weights=>Object.values(weights).some(n=>n!==0))),
  tieBreak:v.optional(v.picklist(['oldest','newest']),'oldest'),
});
const RankingPolicy=v.strictObject({
  profiles:v.pipe(v.record(v.pipe(v.string(),v.regex(/^[a-z][a-z0-9_-]{0,31}$/)),RankingProfile),v.check(p=>Object.keys(p).length>0&&Object.keys(p).length<=8)),
  maxAgeSeconds:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(604800)),DEFAULT_RANKING_LIMITS.maxAgeSeconds),
});
const RankingBudget=v.strictObject({
  maxRequestsPerHour:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(1000000)),DEFAULT_RANKING_LIMITS.maxRequestsPerHour),
  maxRowsWrittenPerDay:v.optional(v.pipe(v.number(),v.integer(),v.minValue(256)),DEFAULT_RANKING_LIMITS.maxRowsWrittenPerDay),
  maxRowsReadPerDay:v.optional(v.pipe(v.number(),v.integer(),v.minValue(256)),DEFAULT_RANKING_LIMITS.maxRowsReadPerDay),
  maxOrderBytes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1024),v.maxValue(33554432)),DEFAULT_RANKING_LIMITS.maxOrderBytes),
});
export const RepositoryPolicy = v.strictObject({
  ranking:v.optional(RankingPolicy),
  origins: v.union([v.literal('*'),v.pipe(v.array(Origin),v.maxLength(30))]),
  category: CategoryName,
  categoryId: v.optional(EmptyNodeID, ''),
  maxReplyPrefetch: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)), 20),
  displayCacheMs: v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(3600000)),60000),
  countCacheMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3600000)), 300000),
  defaultCommentOrder: v.optional(Order, 'oldest'),
  customThemeOrigins: v.optional(v.pipe(v.array(Origin), v.maxLength(20)), []),
});
export const RepositoryPolicies = v.pipe(v.custom<Record<string,unknown>>(x=>x!==null&&typeof x==='object'&&!Array.isArray(x)),v.record(v.pipe(v.string(), v.regex(/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9_.-]{1,100}$/), v.check(s => !s.endsWith('/.') && !s.endsWith('/..'))), RepositoryPolicy),
  v.check(p => Object.keys(p).length <= 100),
  v.check(p => Object.keys(p).every(k => k === k.toLowerCase())));
export const PublicConfig = v.strictObject({
  origin: Origin,
  appId: v.pipe(v.string(), v.regex(/^[1-9]\d{0,18}$/)),
  clientId: v.pipe(v.string(), v.minLength(3), v.maxLength(100), v.regex(/^[A-Za-z0-9_.-]+$/)),
  repositories: RepositoryPolicies,
  openHosting:v.optional(v.pipe(RepositoryPolicy,v.check(p=>!p.ranking))),
  rankingBudget:v.optional(RankingBudget,{}),
});
export const SecretConfig = v.strictObject({
  clientSecret: Token,
  privateKey: v.pipe(v.string(), v.minLength(100), v.maxLength(16000)),
  sessionSecret: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
});
export type RepositoryPolicy = v.InferOutput<typeof RepositoryPolicy>;
export type PublicConfig = v.InferOutput<typeof PublicConfig>;
export type SecretConfig = v.InferOutput<typeof SecretConfig>;
export interface ConfigBindings { PUBLIC_ORIGIN: string; GITHUB_APP_ID: string; GITHUB_CLIENT_ID: string; REPOSITORIES: unknown; GITHUB_CLIENT_SECRET: string; GITHUB_PRIVATE_KEY: string; SESSION_SECRET: string; OPEN_HOSTING?:unknown; RANKING_BUDGET?:unknown }
const cache = new WeakMap<object, PublicConfig>();
export function configuration(env: ConfigBindings): PublicConfig {
  // Cache the parsed deployment settings, not pending requests.
  const cached = cache.get(env); if (cached) return cached;
  const repositories = typeof env.REPOSITORIES === 'string' ? parseJSON(env.REPOSITORIES, 'config') : env.REPOSITORIES;
  const config = parse(PublicConfig, { origin: env.PUBLIC_ORIGIN, appId: env.GITHUB_APP_ID, clientId: env.GITHUB_CLIENT_ID, repositories,rankingBudget:typeof env.RANKING_BUDGET==='string'?parseJSON(env.RANKING_BUDGET,'config'):env.RANKING_BUDGET,...(env.OPEN_HOSTING?{openHosting:typeof env.OPEN_HOSTING==='string'?parseJSON(env.OPEN_HOSTING,'config'):env.OPEN_HOSTING}:{}) }, 'config');
  cache.set(env, config); return config;
}
export function secrets(env: ConfigBindings): SecretConfig {
  return parse(SecretConfig, { clientSecret: env.GITHUB_CLIENT_SECRET, privateKey: env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n'), sessionSecret: env.SESSION_SECRET }, 'config');
}
