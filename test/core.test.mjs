import test from 'node:test';import assert from 'node:assert/strict';import {verify,createHash}from'node:crypto';
import {core,sqlite,fixture,PRIVATE_KEY,PRIVATE_KEY8,PUBLIC_KEY,REPO,BLOG,expectJSON}from'./fixtures.mjs';
const {cryptography:k,stored:s}=core;
for(const [label,pem]of[['PKCS#1',PRIVATE_KEY],['PKCS#8',PRIVATE_KEY8]])test('native Web Crypto JWT independently verifies for '+label,async()=>{
 const jwt=await k.appJWT('12345',pem,1700000000000),[h,p,sig]=jwt.split('.');assert.equal(verify('RSA-SHA256',Buffer.from(h+'.'+p),PUBLIC_KEY,Buffer.from(sig,'base64url')),true);assert.deepEqual(JSON.parse(Buffer.from(p,'base64url')),{iss:'12345',iat:1699999940,exp:1700000540});
});
test('AES-GCM uses random nonces, authenticates context, and rejects altered ciphertext',async()=>{
 const secret=k.random(),data={version:2,number:10},a=await k.encrypt(data,secret,'a'),b=await k.encrypt(data,secret,'a');assert.notEqual(a,b);assert.deepEqual(await k.decrypt(s.Mapping,a,secret,'a'),data);
 for(const[c,key,context]of[[a,secret,'b'],[a,k.random(),'a'],[a.slice(0,-8),secret,'a'],['1.'+a.slice(2),secret,'a']])await assert.rejects(k.decrypt(s.Mapping,c,key,context));
 await assert.rejects(k.decrypt(s.Mapping,await k.encrypt({version:2,number:'10'},secret,'a'),secret,'a'));assert.equal(await k.sha1('abc'),'a9993e364706816aba3e25717850c26c9cd0d89d');assert.equal(await k.hash('hello'),createHash('sha256').update('hello').digest('base64url'));
});
test('SQL records survive store reconstruction, expire on read, and use bound parameters',()=>{
 const sql=sqlite();let now=100;let store=new core.Store(sql,()=>now);const injection="' OR 1=1 --";store.put(injection,s.Mapping,{version:2,number:1});store.put('expire',s.Mapping,{version:2,number:2},150);store=new core.Store(sql,()=>now);assert.equal(store.get(injection,s.Mapping).number,1);now=151;assert.equal(store.get('expire',s.Mapping),null);assert.equal(store.get(injection,s.Mapping).number,1);sql.db.close();
});
test('async locking serializes external work and recovers from rejection',async()=>{
 const sql=sqlite(),store=new core.Store(sql),order=[];await Promise.all([store.lock('a',async()=>{order.push(1);await new Promise(r=>setTimeout(r,10));order.push(2);}),store.lock('a',async()=>order.push(3))]);assert.deepEqual(order,[1,2,3]);await assert.rejects(store.lock('a',async()=>{throw new Error('expected');}));assert.equal(await store.lock('a',async()=>4),4);sql.db.close();
});
test('expiry alarms target the nearest expiry and remove themselves when idle',async()=>{
 const sql=sqlite();let now=1000,alarm=null;const store=new core.Store(sql,()=>now),state={storage:{getAlarm:async()=>alarm,setAlarm:async x=>{alarm=x;},deleteAlarm:async()=>{alarm=null;}}};store.put('later',s.Mapping,{version:2,number:1},5000);store.put('earlier',s.Mapping,{version:2,number:2},3000);await store.schedule(state);assert.equal(alarm,3000);now=6000;store.prune();await store.schedule(state);assert.equal(alarm,null);sql.db.close();
});
test('public widget shell uses native limiting but no Durable Object; thread uses one named RPC',async()=>{
 const f=fixture({seed:true}),q=new URLSearchParams({repo:REPO,origin:BLOG,term:'article'});const shell=await f.request('/widget?'+q);assert.equal(shell.status,200);assert.equal(f.counts.rpc.length,0);assert.equal(f.counts.read,1);
 await expectJSON(await f.request('/api/thread',{config:f.config}));assert.deepEqual(f.counts.rpc,['thread']);assert.equal(f.counts.read,2);f.close();
});
test('native limiter rejects without creating a counter Durable Object',async()=>{
 const f=fixture();f.counts.denied=true;await expectJSON(await f.request('/api/thread',{config:f.config}),429);assert.equal(f.counts.rpc.length,0);f.close();
});
test('same-origin checks and repository allowlist are independent of schema validation',async()=>{
 const f=fixture();await expectJSON(await f.request('/api/thread',{config:f.config},'',{Origin:'https://evil.example'}),403);await expectJSON(await f.request('/api/thread',{config:f.config},'',{'Sec-Fetch-Site':'cross-site'}),403);await expectJSON(await f.request('/api/thread',{config:{...f.config,repo:'evil/repo'}}),403);assert.equal(f.counts.rpc.length,0);f.close();
});
test('custom CSS host and iframe origins are exact allowlists',async()=>{
 const f=fixture(),url=theme=>'/widget?'+new URLSearchParams({repo:REPO,origin:BLOG,term:'article',theme});const denied=await f.request(url('https://evil.example/theme.css'));assert.equal(denied.status,403);
 const allowed=await f.request(url(BLOG+'/theme.css'));assert.equal(allowed.status,200);assert.match(allowed.headers.get('Content-Security-Policy'),/frame-ancestors https:\/\/blog.example/);assert.equal(allowed.headers.get('Cache-Control'),'no-store');f.close();
});
