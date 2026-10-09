import type * as v from 'valibot';
import * as R from './requests.js';
import type {ContentInputData} from './content.js';
import type {Schema} from './parse.js';
import {API_PREFIX} from './protocol.js';

type Options={sameOrigin?:boolean;cache?:boolean;authenticated?:boolean;rate?:'read'|'write'|'auth'};
function operation<S extends Schema,M extends 'get'|'post'>(path:string,request:S,method:M,options:Options={}){
  return {sameOrigin:options.sameOrigin??false,path:path.startsWith('/')?path:API_PREFIX+'/'+path,request,cache:options.cache??false,authenticated:options.authenticated??false,rate:options.rate??(method==='get'?'read':'write'),method};
}
/** Only external inputs have runtime schemas. Trusted calls derive from those inputs. */
export const operations={
  info:operation('config',R.InfoRequest,'get',{cache:true}),
  counts:{...operation('counts',R.CountsRequest,'get',{cache:true}),methods:['get','post'] as const},
  page:operation('page',R.PageRequest,'get',{cache:true}),
  access:operation('access',R.AccessRequest,'post',{authenticated:true,rate:'read'}),
  session:operation('session',R.InfoRequest,'post',{rate:'read'}),
  identity:operation('identity',R.InfoRequest,'post',{authenticated:true,rate:'read'}),
  ranking:operation('ranking',R.RankingRequest,'get'),
  contribute:operation('contribute',R.ContributionRequest,'post',{authenticated:true}),
  authPrepare:operation('auth/prepare',R.AuthPrepare,'post',{rate:'auth',sameOrigin:true}),
  authCallback:operation('/auth/callback',R.AuthCallbackQuery,'get',{rate:'auth'}),
  logout:operation('logout',R.LogoutRequest,'post',{authenticated:true}),
};
export type Operation=keyof typeof operations|'interpret';
type Request<K extends Operation>=v.InferOutput<(typeof operations)[K&keyof typeof operations]['request']>;
export type Input<K extends Operation>=
  K extends 'interpret'?{config:R.Selection;inputs:ContentInputData[]}:
  K extends 'authCallback'?R.AuthStartQuery&{code:string;denied:boolean}:Request<K>;
export interface Authority {session?:string;browserCookie?:string}
