import * as v from 'valibot';
import * as R from './requests.js';
import { Capability, EmptyCapability, RepositoryName } from './primitives.js';
import type { Schema } from './parse.js';

type Method = 'get' | 'post';
type Options = { sameOrigin?:boolean; cache?: boolean; authenticated?: boolean; rate?: 'read' | 'write' | 'auth' };
function operation<S extends Schema, C extends Schema, M extends Method>(path: string, request: S, call: C, method: M, options: Options = {}) {
  return { sameOrigin:options.sameOrigin??false,path:path.startsWith('/')?path:'/api/v6/'+path, request, call, cache: options.cache ?? false, authenticated: options.authenticated ?? false, rate: options.rate ?? (method === 'get' ? 'read' : 'write'), envelope: 'direct' as const, method };
}
function write<S extends Schema>(path: string, request: S) {
  return { ...operation(path, request, v.strictObject({ request, session: Capability }), 'post', { authenticated: true }), envelope: 'session' as const };
}
export const operations = {
  info: operation('config', R.InfoRequest, R.InfoRequest, 'get', { cache: true }),
  counts:{...operation('counts',R.CountsRequest,R.CountsRequest,'get',{cache:true}),methods:['get','post'] as const},
  page: operation('page',R.PageRequest,R.PageRequest,'get',{cache:true}),
  access:{...operation('access',R.AccessRequest,v.strictObject({request:R.AccessRequest,session:Capability}),'post',{authenticated:true,rate:'read'}),envelope:'session' as const},
  session:{...operation('session',R.InfoRequest,v.strictObject({request:R.InfoRequest,session:v.optional(EmptyCapability,'')}),'post',{rate:'read'}),envelope:'session' as const},
  ranking: { ...operation('ranking', R.RankingRequest, v.strictObject({ request: R.RankingRequest, session: EmptyCapability }), 'get'), envelope: 'session' as const },
  interpret:operation('interpret',R.InterpretRequest,R.InterpretRequest,'post'),
  contribute: write('contribute', R.ContributionRequest),
  authPrepare: operation('auth/prepare', R.AuthPrepare, v.strictObject({ request: R.AuthPrepare, browserCookie: Capability }), 'post', { rate: 'auth',sameOrigin:true }),
  authCallback: operation('/auth/callback', R.AuthCallbackQuery, v.strictObject({ repo:RepositoryName,registration:v.optional(v.pipe(v.string(),v.maxLength(8192))),attempt:Capability, browserCookie: EmptyCapability, code: v.optional(v.pipe(v.string(), v.maxLength(1024)), ''), denied: v.boolean() }), 'get', { rate: 'auth' }),
  logout: write('logout', R.LogoutRequest),
};
export type Operation = keyof typeof operations;
export type Input<K extends Operation> = v.InferOutput<(typeof operations)[K]['call']>;
