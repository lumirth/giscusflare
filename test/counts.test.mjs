import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON as readJSON, REPO, BLOG, core } from './fixtures.mjs';
async function expectJSON(response,status=200){
 const value=await readJSON(response,status);
 if(value.counts){assert.ok(Number.isFinite(value.observedAt));assert.ok(value.expiresAt>=value.observedAt);return {counts:value.counts};}
 return value;
}
const request = {repo:REPO, origin:BLOG+'/notes', terms:['article','missing'], strict:false};
test('counts batch returns root counts and cached zeroes without loading threads',async()=>{
 const f=fixture({seed:true});
 try {
  assert.deepEqual(await expectJSON(await f.request('/api/v2/counts',request)),{counts:{article:23,missing:0}});
  assert.equal(f.counts.read,1); assert.deepEqual(f.counts.rpc,['counts']);
  assert.equal(f.upstream.calls.filter(c=>c.operation==='CommentCounts').length,1);
  assert.equal(f.upstream.calls.filter(c=>c.operation==='Thread').length,0);
  const calls=f.upstream.calls.length;
  await Promise.all([f.request('/api/v2/counts',request),f.request('/api/v2/counts',request)]);
  assert.equal(f.upstream.calls.length,calls);
  f.upstream.hideSearch=true; f.advance(60_001);
  assert.deepEqual(await expectJSON(await f.request('/api/v2/counts',request)),{counts:{article:23,missing:0}},'mapped discussions remain stable when search is delayed');
 } finally {f.close();}
});
test('count reads enforce origin, batch size and public repository scope',async()=>{
 const f=fixture({seed:true});
 try {
  await expectJSON(await f.request('/api/v2/counts',{...request,origin:'https://evil.example'}),403);
  await expectJSON(await f.request('/api/v2/counts',{...request,terms:Array(21).fill('article')}),400);
  f.upstream.meta.isPrivate=true;
  await expectJSON(await f.request('/api/v2/counts',request),403);
 }finally{f.close();}
});
test('strict counts use the same identity as comments and writes invalidate counts',async()=>{
 const f=fixture();
 try {
  const term='kukas:stable',digest=await core.cryptography.sha1(term);
  f.upstream.addThread('Changed title',{body:'<!-- sha1: '+digest+' -->'});
  const input={...request,strict:true,terms:[term]};
  assert.deepEqual(await expectJSON(await f.request('/api/v2/counts',input)),{counts:{[term]:0}});
  const session=await f.session();
  await expectJSON(await f.request('/api/v2/comment',{config:{...f.config,term,strict:true},body:'A root comment',key:Date.now()+'.'+crypto.randomUUID()},session));
  assert.deepEqual(await expectJSON(await f.request('/api/v2/counts',input)),{counts:{[term]:1}});
  assert.equal(f.upstream.discussions.length,1);
 }finally{f.close();}
});

test('overlapping cold batches share upstream reads',async()=>{
 const f=fixture({seed:true});
 try {
  const results=await Promise.all([f.request('/api/v2/counts',request),f.request('/api/v2/counts',request)]);
  for(const response of results) assert.deepEqual(await expectJSON(response),{counts:{article:23,missing:0}});
  assert.equal(f.upstream.calls.filter(c=>c.operation==='CommentCounts').length,1);
 }finally{f.close();}
});

test('different overlapping batches share counts across page URLs, including missing discussions',async()=>{
 const f=fixture({seed:true});try{
  const [a,b]=await Promise.all([
   f.request('/api/v2/counts',{...request,terms:['article','missing']}),
   f.request('/api/v2/counts',{...request,origin:BLOG+'/archive',terms:['missing','another']})
  ]);
  assert.deepEqual((await expectJSON(a)).counts,{article:23,missing:0});
  assert.deepEqual((await expectJSON(b)).counts,{missing:0,another:0});
  const queries=f.upstream.calls.filter(c=>c.operation==='CommentCounts');
  assert.equal(queries.length,2);
  const before=f.upstream.calls.length;
  await expectJSON(await f.request('/api/v2/counts',{...request,origin:BLOG+'/elsewhere',terms:['another','article']}));
  assert.equal(f.upstream.calls.length,before);
 }finally{f.close();}
});
test('writing one discussion preserves other discussion counts and display reads',async()=>{
 const f=fixture({seed:true});try{
  f.upstream.addThread('other');
  await expectJSON(await f.request('/api/v2/thread',{config:{...f.config,term:'other'}}));
  await expectJSON(await f.request('/api/v2/counts',{...request,terms:['article','other']}));
  const cap=await f.session();
  await expectJSON(await f.request('/api/v2/comment',{config:f.config,body:'new',key:f.clock()+'.'+crypto.randomUUID()},cap));
  const before=f.upstream.calls.length;
  await expectJSON(await f.request('/api/v2/thread',{config:{...f.config,term:'other'}}));
  assert.equal((await expectJSON(await f.request('/api/v2/counts',{...request,terms:['other']}))).counts.other,0);
  assert.equal(f.upstream.calls.length,before);
  assert.equal((await expectJSON(await f.request('/api/v2/counts',{...request,terms:['article']}))).counts.article,24);
 }finally{f.close();}
});
