import test from'node:test';import assert from'node:assert/strict';import {core,fixture,login,expectJSON,REPO}from'./fixtures.mjs';
test('complete OAuth protocol binds browser cookie, provider PKCE and independent browser proof',async()=>{
 const f=fixture(),flow=await login(f);assert.match(flow.cap,/^[A-Za-z0-9_-]{43}$/);assert.ok(!flow.html.includes('ghu_')&&!flow.html.includes('ghr_'));
 const current=await expectJSON(await f.request('/api/v2/thread',{config:f.config},flow.cap));assert.equal(current.viewer.login,'reader');
 await expectJSON(await f.request('/api/v2/auth/consume',{repo:REPO,origin:f.config.origin,attempt:flow.attempt,verifier:flow.verifier,ticket:flow.ticket}),401);
 const raw=JSON.stringify(f.sql.exec('SELECT * FROM records_v2'));for(const secret of ['ghu_reader','ghr_reader',flow.cap,flow.verifier])assert.ok(!raw.includes(secret));f.close();
});
test('callback cannot manufacture a cookie for an attacker-created OAuth attempt',async()=>{
 const f=fixture(),verifier=core.cryptography.random(),challenge=await core.cryptography.hash(verifier);
 const prepared=await f.request('/api/v2/auth/prepare',{repo:REPO,origin:f.config.origin,challenge,mode:'popup'}),cookie=prepared.headers.get('Set-Cookie').split(';')[0],data=await expectJSON(prepared),url=new URL(data.authorizeURL),path='/auth/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'fixture_'+url.searchParams.get('code_challenge')});
 await expectJSON(await f.request(path),401);
 const callback=await f.request(path,undefined,'',{Cookie:cookie});assert.equal(callback.status,200);
 await expectJSON(await f.request(path,undefined,'',{Cookie:cookie}),409);
 await expectJSON(await f.request('/api/v2/auth/poll',{repo:REPO,origin:f.config.origin,attempt:data.attempt,verifier:core.cryptography.random()}),403);f.close();
});
test('opener-free proof polling returns a one-use ticket, never a GitHub token',async()=>{
 const f=fixture(),verifier=core.cryptography.random(),challenge=await core.cryptography.hash(verifier),prepare=await f.request('/api/v2/auth/prepare',{repo:REPO,origin:f.config.origin,challenge,mode:'popup'}),cookie=prepare.headers.get('Set-Cookie').split(';')[0],data=await expectJSON(prepare),proof={repo:REPO,origin:f.config.origin,attempt:data.attempt,verifier};
 assert.deepEqual(await expectJSON(await f.request('/api/v2/auth/poll',proof)),{status:'pending'});
 const u=new URL(data.authorizeURL);await f.request('/auth/callback?'+new URLSearchParams({state:u.searchParams.get('state'),code:'fixture_'+u.searchParams.get('code_challenge')}),undefined,'',{Cookie:cookie});
 const ready=await expectJSON(await f.request('/api/v2/auth/poll',proof));assert.equal(ready.status,'ready');assert.deepEqual(Object.keys(ready).sort(),['status','ticket']);
 const cap=await expectJSON(await f.request('/api/v2/auth/consume',{...proof,ticket:ready.ticket}));assert.match(cap.session,/^[A-Za-z0-9_-]{43}$/);f.close();
});
test('bad/expired state and cancelled authorization never become sessions',async()=>{
 const f=fixture(),verifier=core.cryptography.random(),challenge=await core.cryptography.hash(verifier);let prepared=await f.request('/api/v2/auth/prepare',{repo:REPO,origin:f.config.origin,challenge,mode:'redirect'}),cookie=prepared.headers.get('Set-Cookie').split(';')[0],data=await expectJSON(prepared),u=new URL(data.authorizeURL);
 f.advance(601000);await expectJSON(await f.request('/auth/callback?'+new URLSearchParams({state:u.searchParams.get('state'),code:'fixture_'+u.searchParams.get('code_challenge')}),undefined,'',{Cookie:cookie}),401);
 prepared=await f.request('/api/v2/auth/prepare',{repo:REPO,origin:f.config.origin,challenge,mode:'redirect'});cookie=prepared.headers.get('Set-Cookie').split(';')[0];data=await expectJSON(prepared);u=new URL(data.authorizeURL);
 assert.equal((await f.request('/auth/callback?'+new URLSearchParams({state:u.searchParams.get('state'),error:'access_denied'}),undefined,'',{Cookie:cookie})).status,200);
 assert.deepEqual(await expectJSON(await f.request('/api/v2/auth/poll',{repo:REPO,origin:f.config.origin,attempt:data.attempt,verifier})),{status:'denied'});f.close();
});
test('concurrent readers perform one rotating refresh and logout invalidates the capability',async()=>{
 const f=fixture(),cap=await f.session('reader',{accessExpires:f.clock()+1000});await Promise.all([1,2,3].map(async()=>expectJSON(await f.request('/api/v2/thread',{config:f.config},cap))));assert.equal(f.upstream.refreshes,1);await expectJSON(await f.request('/api/v2/logout',{repo:REPO,origin:f.config.origin},cap));await expectJSON(await f.request('/api/v2/thread',{config:f.config},cap),401);f.close();
});
test('sessions are bound to their embedding origin and schema-validated after decrypt',async()=>{
 const f=fixture(),cap=await f.session();await expectJSON(await f.request('/api/v2/thread',{config:{...f.config,origin:'https://evil.example'}},cap),403);
 const id=await core.cryptography.hash(cap);await f.store.putSecret('session:'+id,core.stored.Session,{accessToken:'ghu_reader',accessExpires:f.clock()+10000,refreshToken:null,refreshExpires:0,user:{login:'reader',avatarUrl:'https://avatars.githubusercontent.com/u/1',url:'https://github.com/reader'},repo:REPO,origin:'https://elsewhere.example',expires:f.clock()+10000},f.env.SESSION_SECRET,`${f.env.GITHUB_APP_ID}:${f.env.GITHUB_CLIENT_ID}:${REPO}`,f.clock()+10000);
 await expectJSON(await f.request('/api/v2/thread',{config:f.config},cap),401);f.close();
});
