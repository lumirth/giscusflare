import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON, BLOG, SERVICE } from './fixtures.mjs';

test('native API binds request origin to the selected repository and page',async()=>{
 const f=fixture({seed:true});try{
  const response=await f.request('/api/v2/thread',{config:f.config},'',{Origin:BLOG,'Sec-Fetch-Site':'cross-site'});
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),BLOG);assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  assert.ok((await expectJSON(response)).discussion);
  await expectJSON(await f.request('/api/v2/thread',{config:{...f.config,origin:'https://evil.example/page'}},'',{Origin:BLOG,'Sec-Fetch-Site':'cross-site'}),403);
  await expectJSON(await f.request('/api/v2/thread',{config:f.config},'',{Origin:'https://evil.example','Sec-Fetch-Site':'cross-site'}),403);
 }finally{f.close();}
});

test('native bearer actions work; cookie-producing auth prepare remains service-only',async()=>{
 const f=fixture({seed:true});try{
  const session=await f.session();
  const r=await expectJSON(await f.request('/api/v2/comment',{config:f.config,key:Date.now()+'.'+crypto.randomUUID(),body:'Native client comment'},session,{Origin:BLOG,'Sec-Fetch-Site':'cross-site'}));assert.equal(r.comment.body,'Native client comment');
  await expectJSON(await f.request('/api/v2/auth/prepare',{repo:f.config.repo,origin:f.config.origin,challenge:'x'.repeat(43),mode:'popup'},'',{Origin:BLOG,'Sec-Fetch-Site':'cross-site'}),403);
 }finally{f.close();}
});

test('preflight permits only configured native origins and POST',async()=>{
 const f=fixture();try{
  for(const [origin,method,status] of [[BLOG,'POST',204],['https://evil.example','POST',403],[BLOG,'DELETE',403]]){
   const {core}=await import('./fixtures.mjs');
   const result=await core.app.fetch(new Request(SERVICE+'/api/v2/thread',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':method}}),f.env);
   assert.equal(result.status,status);
  }
 }finally{f.close();}
});

test('OAuth opener can be the authorized native page, never an unrelated origin',async()=>{
 const f=fixture();try{
  const {core}=await import('./fixtures.mjs');
  for(const [openerOrigin,status] of [[BLOG,200],[SERVICE,200],['https://evil.example',403]]){
   await expectJSON(await f.request('/api/v2/auth/prepare',{repo:f.config.repo,origin:f.config.origin,challenge:await core.cryptography.hash(core.cryptography.random()),mode:'popup',openerOrigin}),status);
  }
 }finally{f.close();}
});
