import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,expectJSON,core,REPO,BLOG,SERVICE} from './fixtures.mjs';

test('mapped anonymous misses consolidate scope and display, while cached reads do no repository SQL or GitHub work',async()=>{
 const f=fixture({seed:true});try{
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  let sql=0;const exec=f.sql.exec;f.sql.exec=(...args)=>{sql++;return exec(...args);};
  const start=f.upstream.calls.length;
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  assert.equal(sql,0);assert.equal(f.upstream.calls.length,start);
  f.advance(60001);
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  assert.deepEqual(f.upstream.calls.slice(start).map(x=>x.operation),['CombinedThread']);
 }finally{f.close();}
});
test('public scope changes on GitHub are observed at the original TTL boundary',async()=>{
 const f=fixture({seed:true});try{
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  f.upstream.meta.isPrivate=true;
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  f.advance(60001);
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}),403);
 }finally{f.close();}
});
test('count values and misses never create durable count-cache rows',async()=>{
 const f=fixture({seed:true});try{
  await expectJSON(await f.request('/api/v2/counts',{repo:REPO,origin:BLOG,terms:['article','missing'],strict:false}));
  assert.equal([...f.sql.exec("SELECT key FROM records_v2 WHERE key LIKE 'count:%'")].length,0);
 }finally{f.close();}
});
test('response reuse coalesces reads, preserves expiry, and fences a fill begun before mutation',async()=>{
 let now=1000,calls=0,resolve;
 const cache=new core.ReadCache(()=>now,1024);
 const load=()=>{calls++;return new Promise(r=>resolve=r);};
 const first=cache.response('page','discussion',60000,load),second=cache.response('page','discussion',60000,load);
 await Promise.resolve();assert.equal(calls,1);now=21000;cache.invalidate(group=>group==='discussion');resolve({value:'old'});
 const old=await first;assert.equal(old.headers.get('X-Giscusflare-Expires'),'61000');assert.equal(old.headers.get('Cache-Control'),'public, max-age=40');await second;
 const fresh=await cache.response('page','discussion',60000,async()=>{calls++;return{value:'new'};});
 assert.equal(calls,2);assert.equal((await fresh.json()).value,'new');
 now=31000;const hit=await cache.response('page','discussion',60000,()=>{throw Error('must reuse');});
 assert.equal(hit.headers.get('X-Giscusflare-Expires'),'81000');
});
test('expired missing receipt never repeats a write; uncertain markers outlive the retry window',async()=>{
 const f=fixture(),cap=await f.session();try{
  const expired={config:f.config,body:'old',key:(f.clock()-86400001)+'.'+crypto.randomUUID()};
  const denied=await expectJSON(await f.request('/api/v2/comment',expired,cap),409);assert.equal(denied.error.code,'OPERATION_EXPIRED');assert.equal(f.upstream.discussions.length,0);
  f.upstream.addThread('article');f.upstream.failAfterMutation=true;
  const input={config:f.config,body:'uncertain',key:f.clock()+'.'+crypto.randomUUID()};
  await expectJSON(await f.request('/api/v2/comment',input,cap),502);
  const pending=[...f.sql.exec("SELECT expires FROM records_v2 WHERE key LIKE 'receipt:%'")];assert.equal(pending.length,1);assert.equal(pending[0].expires,0);
  f.advance(86400001);f.store.prune();
  const cap2=await f.session();const retry=await expectJSON(await f.request('/api/v2/comment',input,cap2),409);assert.equal(retry.error.code,'WRITE_UNCERTAIN');assert.equal(f.upstream.discussions[0].comments.length,1);
 }finally{f.close();}
});
test('edge cache hits perform policy checks but allocate no repository object',async()=>{
 const f=fixture({seed:true}),entries=new Map(),tasks=[];
 const previous=globalThis.caches;globalThis.caches={default:{match:async key=>entries.get(key.url)?.clone(),put:async(key,response)=>{entries.set(key.url,response);}}};
 const input={config:f.config},url=SERVICE+'/api/v2/thread?'+new URLSearchParams({input:JSON.stringify(input)});
 const request=()=>core.app.fetch(new Request(url),f.env,{waitUntil:p=>tasks.push(p)});
 try{
  await expectJSON(await request());await Promise.all(tasks);assert.equal(entries.size,1);
  const count=f.counts.rpc.length;await expectJSON(await request());assert.equal(f.counts.rpc.length,count);
  const denied=await core.app.fetch(new Request(url,{headers:{Origin:'https://evil.example'}}),f.env,{waitUntil:p=>tasks.push(p)});assert.equal(denied.status,403);assert.equal(f.counts.rpc.length,count);
 }finally{globalThis.caches=previous;f.close();}
});
test('empty deployment serves setup and refuses comment traffic',async()=>{
 const f=fixture();try{
  const env={...f.env,PUBLIC_ORIGIN:'',GITHUB_APP_ID:'',GITHUB_CLIENT_ID:'',REPOSITORIES:{},GITHUB_PRIVATE_KEY:''};
  const setup=await core.app.fetch(new Request(SERVICE+'/api/v2/setup'),env);assert.deepEqual(await setup.json(),{configured:false,origin:SERVICE});
  const denied=await core.app.fetch(new Request(SERVICE+'/widget?'+new URLSearchParams({repo:REPO,origin:BLOG,term:'article'})),env);assert.equal(denied.status,503);assert.equal(f.counts.rpc.length,0);
 }finally{f.close();}
});

test('open hosting rejects uninstalled repositories before any Durable Object allocation',async()=>{
 const f=fixture({seed:true}),original=globalThis.fetch;let calls=0;
 f.env.OPEN_HOSTING={origins:'*',category:'Announcements'};
 globalThis.fetch=async(url,options)=>{calls++;const path=new URL(url).pathname;return path.endsWith('/installation')?Response.json({message:'not found'},{status:404}):Response.json({node_id:'R_other',full_name:'other/discussions',private:false});};
 try{
  const body={config:{...f.config,repo:'other/discussions',origin:'https://another.example/post'}};
  await expectJSON(await f.request('/api/v2/thread',body,'',{Origin:'https://another.example','Sec-Fetch-Site':'cross-site'}),403);
  assert.equal(f.counts.rpc.length,0);const before=calls;
  await expectJSON(await f.request('/api/v2/thread',body,'',{Origin:'https://another.example','Sec-Fetch-Site':'cross-site'}),403);assert.equal(calls,before);
 }finally{globalThis.fetch=original;f.close();}
});
test('open hosting binds installed public repositories to canonical GitHub IDs and still checks page scope',async()=>{
 const f=fixture({seed:true}),original=globalThis.fetch,objects=[];
 f.env.OPEN_HOSTING={origins:'*',category:'Announcements'};
 f.env.REPOSITORIES={};
 const get=f.env.REPOSITORY_STORE.get;f.env.REPOSITORY_STORE.get=id=>{objects.push(id);return get(id);};
 globalThis.fetch=async(url,options)=>{assert.match(options.headers.Authorization,/^Bearer /);if(new URL(url).pathname.endsWith('/installation'))return Response.json({id:123});assert.deepEqual(JSON.parse(options.body),{repositories:[REPO.split('/')[1]],permissions:{metadata:'read'}});return Response.json({repositories:[{node_id:'R_fixture',full_name:REPO,private:false}]});};
 try{
  const body={config:{...f.config,origin:'https://another.example/post'}};
  await expectJSON(await f.request('/api/v2/thread',body,'',{Origin:'https://another.example','Sec-Fetch-Site':'cross-site'}));
  assert.deepEqual(objects,['v2:12345:R_fixture']);
  await expectJSON(await f.request('/api/v2/thread',body,'',{Origin:'https://wrong.example','Sec-Fetch-Site':'cross-site'}),403);
 }finally{globalThis.fetch=original;f.close();}
});

test('data requests reject appearance fields and creation metadata survives the new contract',async()=>{
 const f=fixture();try{
  await expectJSON(await f.request('/api/v2/thread',{config:{...f.config,theme:'dark'}}),400);
  const cap=await f.session();
  await expectJSON(await f.request('/api/v2/comment',{config:f.config,creation:{description:'A real description',backLink:BLOG+'/canonical'},body:'hello',key:f.clock()+'.'+crypto.randomUUID()},cap));
  assert.match(f.upstream.discussions[0].body,/A real description/);
  assert.match(f.upstream.discussions[0].body,/canonical/);
 }finally{f.close();}
});
