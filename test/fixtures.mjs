import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import * as core from '../dist/testing.mjs';
import { FakeGitHub } from './github-fixture.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
export const PRIVATE_KEY=pair.privateKey.export({type:'pkcs1',format:'pem'}).toString();
export const PRIVATE_KEY8=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
export const PUBLIC_KEY=pair.publicKey;
export const REPO='example/comments', BLOG='https://blog.example', SERVICE='https://comments.example';
export function sqlite(path=':memory:') {const db=new DatabaseSync(path);return {db,exec(query,...args){return db.prepare(query).all(...args);}};}
export function fixture({seed=false,origin=SERVICE,blog=BLOG,privateKey=PRIVATE_KEY,filename=':memory:'}={}) {
  let now=Date.now(); const clock=()=>now, sql=sqlite(filename), store=new core.Store(sql,clock), upstream=new FakeGitHub({seed,now:clock});
  const counts={read:0,write:0,auth:0,rpc:[],denied:false};
  const env={PUBLIC_ORIGIN:origin,GITHUB_APP_ID:'12345',GITHUB_CLIENT_ID:'Iv1.fixture',GITHUB_CLIENT_SECRET:'fixture-client-secret',GITHUB_PRIVATE_KEY:privateKey,SESSION_SECRET:core.cryptography.random(),REPOSITORIES:{[REPO]:{origins:[blog],category:'Announcements'}},ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
  for(const [name,kind] of [['READ_LIMITER','read'],['WRITE_LIMITER','write'],['AUTH_LIMITER','auth']])env[name]={limit:async()=>{counts[kind]++;return {success:!counts.denied};}};
  const engine=new core.RepositoryEngine(env,store,upstream.fetch);
  const methods=['info','thread','replies','comment','edit','remove','reaction','moderate','preview','discussionAction','block','authPrepare','authCallback','authPoll','authConsume','logout'];
  const stub=Object.fromEntries(methods.map(name=>[name,async input=>{counts.rpc.push(name);return core.result(()=>engine[name](input));}]));
  env.REPOSITORY_STORE={idFromName:name=>name,get:name=>stub};
  const config=core.parse(core.requests.Widget,{repo:REPO,origin:blog+'/article',term:'article'});
  async function request(path,body,cap='',headers={}) {
    return core.app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',...(body===undefined?{}:{'Content-Type':'application/json'}),...(cap?{Authorization:'Bearer '+cap}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
  }
  async function session(user='reader', overrides={}){
    const cap=core.cryptography.random(),id=await core.cryptography.hash(cap);
    const data={accessToken:'ghu_'+user,accessExpires:clock()+28800000,refreshToken:'ghr_'+user,refreshExpires:clock()+15552000000,user:{login:user,avatarUrl:'https://avatars.githubusercontent.com/u/1',url:'https://github.com/'+user},repo:REPO,origin:blog,expires:clock()+30*86400000,...overrides};
    await store.putSecret('session:'+id,core.stored.Session,data,env.SESSION_SECRET,`${env.GITHUB_APP_ID}:${env.GITHUB_CLIENT_ID}:${REPO}`,data.expires);return cap;
  }
  return {env,engine,upstream,store,sql,config,counts,clock,session,request,advance(ms){now+=ms;},close(){sql.db.close();}};
}
export async function expectJSON(response,status=200){const value=await response.json();if(response.status!==status)throw new Error(`Expected HTTP ${status}, got ${response.status}: ${JSON.stringify(value)}`);return value;}
export async function login(f,{mode='popup'}={}) {
  const verifier=core.cryptography.random(),challenge=await core.cryptography.hash(verifier);
  const prepared=await f.request('/api/auth/prepare',{repo:REPO,origin:f.config.origin,challenge,mode});
  const cookie=prepared.headers.get('Set-Cookie')?.split(';')[0];
  const data=await expectJSON(prepared),authorize=new URL(data.authorizeURL);
  const callback=await f.request('/auth/callback?'+new URLSearchParams({state:authorize.searchParams.get('state'),code:'fixture_'+authorize.searchParams.get('code_challenge')}),undefined,'',{Cookie:cookie});
  const html=await callback.text();
  if(callback.status!==200)throw new Error('Callback failed: '+html);
  const ready=await expectJSON(await f.request('/api/auth/poll',{repo:REPO,origin:f.config.origin,attempt:data.attempt,verifier}));
  const consumed=await expectJSON(await f.request('/api/auth/consume',{repo:REPO,origin:f.config.origin,attempt:data.attempt,verifier,ticket:ready.ticket}));
  return {cap:consumed.session,attempt:data.attempt,verifier,challenge,cookie,authorize,html,ticket:ready.ticket};
}
export {core,FakeGitHub};
