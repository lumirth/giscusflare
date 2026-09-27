import test from 'node:test';
import assert from 'node:assert/strict';
import {core,fixture,REPO,BLOG,expectJSON} from './fixtures.mjs';
const {parse,requests:r,rpc,configSchemas:c,githubSchemas:g,stored}=core;
test('Hono and Valibot expose the expected validation interfaces',async()=>{
  const {Hono}=await import('hono');const v=await import('valibot');assert.equal(typeof Hono,'function');assert.equal(r.Widget['~standard'].vendor,'valibot');assert.equal(r.Widget['~standard'].version,1);assert.equal(v.safeParse(r.Widget,{repo:REPO,term:'article',origin:BLOG}).success,true);
});
for(const [field,value] of [['number','1'],['number',true],['number',[]],['number',-1],['number',1.25],['number',2147483648],['strict','0'],['reactionsEnabled',1],['inputPosition','botom'],['theme','unknown-theme'],['emitMetadata','false']])test(`normalized JSON refuses ${field}=${JSON.stringify(value)}`,()=>{
  assert.throws(()=>parse(r.Widget,{repo:REPO,term:'article',origin:BLOG,[field]:value}),e=>e.code==='BAD_INPUT');
});
test('query coercion is explicit and duplicate values are rejected',()=>{
  const normalized=parse(r.WidgetQuery,{repo:REPO,origin:BLOG,term:'article',number:'0',strict:'1',emitMetadata:'false'});assert.equal(normalized.number,0);assert.equal(normalized.strict,true);assert.equal(normalized.emitMetadata,false);
  for(const value of ['',' ','1.0','0x1','1e2','-0','+1','Infinity','01'])assert.throws(()=>parse(r.WidgetQuery,{repo:REPO,origin:BLOG,term:'article',number:value}));
  assert.throws(()=>r.queryObject(new URL('https://x.test/?number=1&number=2')));
});
test('strict input schemas reject unknown fields while GitHub schemas tolerate additions',()=>{
  assert.throws(()=>parse(r.InfoRequest,{repo:REPO,origin:BLOG,admin:true}));
  const meta={id:'R_fixture',nameWithOwner:REPO,isPrivate:false,isArchived:false,discussionCategories:{nodes:[]},futureField:{optional:true}};
  assert.equal(parse(g.Repository,meta,'upstream').isPrivate,false);assert.equal('futureField' in parse(g.Repository,meta,'upstream'),false);
  for(const property of ['isPrivate','isArchived','id']){const broken={...meta};delete broken[property];assert.throws(()=>parse(g.Repository,broken,'upstream'),e=>e.status===502&&e.code==='UPSTREAM_SCHEMA');}
});
test('configuration validates every repository policy and does not coerce case-colliding keys',()=>{
  for(const repositories of [[], {'Example/Comments':{origins:[BLOG],category:'Announcements'}},{[REPO]:{origins:['*'],category:'Announcements'}},{[REPO]:{origins:[BLOG],category:'Announcements',defaultCommentOrder:'latest'}},{[REPO]:{origins:[BLOG],category:'Announcements',typo:true}}])assert.throws(()=>parse(c.RepositoryPolicies,repositories,'config'));
  assert.equal(parse(c.RepositoryPolicies,{[REPO]:{origins:[BLOG],category:'Announcements'}})[REPO].defaultCommentOrder,'oldest');
});
test('URLs reject credentials, unsafe schemes, external backlinks, and control characters',()=>{
  for(const origin of ['javascript:alert(1)','http://outside.example','https://user:pass@blog.example',' '+BLOG,BLOG+'\n'])assert.throws(()=>parse(r.Widget,{repo:REPO,origin,term:'article'}));
  assert.throws(()=>parse(r.Widget,{repo:REPO,origin:BLOG,term:'article',backLink:'https://other.example/a'}));
  assert.throws(()=>parse(r.Widget,{repo:REPO,origin:BLOG,term:'article\nrepo:evil'}));
});
test('comment length is constrained in bytes as well as characters',()=>{
  const f=fixture();assert.doesNotThrow(()=>parse(r.CommentRequest,{config:f.config,body:'a'.repeat(60000),key:Date.now()+'.'+'k'.repeat(32)}));
  assert.throws(()=>parse(r.CommentRequest,{config:f.config,body:'😀'.repeat(16000),key:Date.now()+'.'+'k'.repeat(32)}));
  assert.throws(()=>parse(r.CommentRequest,{config:f.config,body:'   ',key:Date.now()+'.'+'k'.repeat(32)}));f.close();
});
test('stored records and RPC arguments must match their schemas',()=>{
  assert.throws(()=>parse(stored.Mapping,{version:1,number:1},'storage'),e=>e.code==='STORAGE');
  assert.throws(()=>parse(stored.RateWindow,{count:'1',resets:1000},'storage'));
  const f=fixture();assert.throws(()=>parse(rpc.CommentCall,{request:{config:f.config,body:'text',key:Date.now()+'.'+'k'.repeat(32)},session:'bad'}));f.close();
});
test('Hono rejects invalid route input before calling the repository',async()=>{
  const f=fixture();for(const body of [{config:{...f.config,number:'1'}},{config:f.config,order:'latest'},{config:f.config,unknown:1}])await expectJSON(await f.request('/api/v1/thread',body),400);
  assert.equal(f.counts.rpc.length,0);f.close();
});
test('streamed size limit and Content-Type are enforced before the Standard Schema validator',async()=>{
  const f=fixture();await expectJSON(await f.request('/api/v1/thread','{}','',{'Content-Type':'text/plain'}),415);
  await expectJSON(await f.request('/api/v1/thread','{'),400);
  await expectJSON(await f.request('/api/v1/thread','{"x":"'+'x'.repeat(100000)+'"}'),413);
  const request=new Request(f.env.PUBLIC_ORIGIN+'/api/v1/thread',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(97000)));c.enqueue(new TextEncoder().encode('x'.repeat(3000)));c.close();}}),duplex:'half'});
  await expectJSON(await core.app.fetch(request,f.env),413);assert.equal(f.counts.rpc.length,0);f.close();
});
test('invalid stored session returns 401 without exposing credentials',async()=>{
  const f=fixture(),cap=await f.session();const id=await core.cryptography.hash(cap);
  f.sql.exec('UPDATE records_v2 SET value=? WHERE key=?',JSON.stringify({version:2,ciphertext:'malformed'}),'session:'+id);
  const output=await expectJSON(await f.request('/api/v1/thread',{config:f.config},cap),401);assert.ok(!JSON.stringify(output).includes('malformed'));f.close();
});

// Removed options fail validation instead of silently selecting a voting mode.
test('widget input rejects the removed voting option in JSON and URL parameters', () => {
  const common = { repo: REPO, origin: BLOG, term: 'article' };
  for (const value of ['thumbs-up', 'reactions']) {
    assert.throws(() => parse(r.Widget, { ...common, voteMode: value }), e => e.code === 'BAD_INPUT');
    assert.throws(() => parse(r.WidgetQuery, { ...common, voteMode: value }), e => e.code === 'BAD_INPUT');
  }
});
test('OAuth callbacks accept GitHub issuer identification and reject another issuer',()=>{
 const state='repo.abc';
 assert.doesNotThrow(()=>core.parse(core.requests.AuthCallbackQuery,{state,code:'code',iss:'https://github.com/login/oauth'}));
 assert.throws(()=>core.parse(core.requests.AuthCallbackQuery,{state,code:'code',iss:'https://evil.example'}));
});
