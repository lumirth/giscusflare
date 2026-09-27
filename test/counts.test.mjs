import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON, REPO, BLOG, core } from './fixtures.mjs';
const request = {repo:REPO, origin:BLOG+'/notes', terms:['article','missing'], strict:false};
test('counts batch returns root counts and cached zeroes without loading threads',async()=>{
 const f=fixture({seed:true});
 try {
  assert.deepEqual(await expectJSON(await f.request('/api/v1/counts',request)),{counts:{article:23,missing:0}});
  assert.equal(f.counts.read,1); assert.deepEqual(f.counts.rpc,['counts']);
  assert.equal(f.upstream.calls.filter(c=>c.operation==='FindCounts').length,1);
  assert.equal(f.upstream.calls.filter(c=>c.operation==='Thread').length,0);
  const calls=f.upstream.calls.length;
  await Promise.all([f.request('/api/v1/counts',request),f.request('/api/v1/counts',request)]);
  assert.equal(f.upstream.calls.length,calls);
  f.upstream.hideSearch=true; f.advance(60_001);
  assert.deepEqual(await expectJSON(await f.request('/api/v1/counts',request)),{counts:{article:23,missing:0}},'mapped discussions remain stable when search is delayed');
 } finally {f.close();}
});
test('count reads enforce origin, batch size and public repository scope',async()=>{
 const f=fixture({seed:true});
 try {
  await expectJSON(await f.request('/api/v1/counts',{...request,origin:'https://evil.example'}),403);
  await expectJSON(await f.request('/api/v1/counts',{...request,terms:Array(21).fill('article')}),400);
  f.upstream.meta.isPrivate=true;
  await expectJSON(await f.request('/api/v1/counts',request),403);
 }finally{f.close();}
});
test('strict counts use the same identity as comments and writes invalidate counts',async()=>{
 const f=fixture();
 try {
  const term='kukas:stable',digest=await core.cryptography.sha1(term);
  f.upstream.addThread('Changed title',{body:'<!-- sha1: '+digest+' -->'});
  const input={...request,strict:true,terms:[term]};
  assert.deepEqual(await expectJSON(await f.request('/api/v1/counts',input)),{counts:{[term]:0}});
  const session=await f.session();
  await expectJSON(await f.request('/api/v1/comment',{config:{...f.config,term,strict:true},body:'A root comment',key:Date.now()+'.'+crypto.randomUUID()},session));
  assert.deepEqual(await expectJSON(await f.request('/api/v1/counts',input)),{counts:{[term]:1}});
  assert.equal(f.upstream.discussions.length,1);
 }finally{f.close();}
});

test('overlapping cold batches share upstream reads',async()=>{
 const f=fixture({seed:true});
 try {
  const results=await Promise.all([f.request('/api/v1/counts',request),f.request('/api/v1/counts',request)]);
  for(const response of results) assert.deepEqual(await expectJSON(response),{counts:{article:23,missing:0}});
  assert.equal(f.upstream.calls.filter(c=>c.operation==='FindCounts').length,1);
 }finally{f.close();}
});
