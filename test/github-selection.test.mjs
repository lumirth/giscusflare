import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON } from './fixtures.mjs';
import { randomUUID } from 'node:crypto';
const key=()=>Date.now()+'.'+randomUUID();

test('writes authorize large discussions and comments without downloading their display content',async()=>{
 const f=fixture(),body='x'.repeat(100000),d=f.upstream.addThread('article',{body,bodyHTML:body}),c=f.upstream.addComment(d,body),cap=await f.session();
 try{
  const result=await expectJSON(await f.request('/api/v1/reaction',{config:{...f.config,number:d.number},id:c.id,reaction:'HEART',add:true,key:key()},cap));
  assert.equal(result.reactions.reactionGroups.find(g=>g.content==='HEART').users.totalCount,1);
  const calls=f.upstream.calls.filter(c=>c.operation);
  assert.deepEqual(calls.map(c=>c.operation),['Repository','DiscussionAccess','Target','React']);
  for(const call of calls.filter(c=>['DiscussionAccess','Target'].includes(c.operation)))assert.doesNotMatch(call.query,/\b(?:body|bodyHTML|reactionGroups|createdAt|author|replies)\b/);
 }finally{f.close();}
});

test('moderation refreshes only its affected comment after minimal authorization',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),c=f.upstream.addComment(d,'Hide this'),cap=await f.session('maintainer');
 try{
  const result=await expectJSON(await f.request('/api/v1/moderate',{config:{...f.config,number:d.number},id:c.id,minimized:true,reason:'OFF_TOPIC',key:key()},cap));
  assert.equal(result.comment.isMinimized,true);assert.equal(result.comment.body,'Hide this');
  assert.deepEqual(f.upstream.calls.filter(c=>c.operation).map(c=>c.operation),['Repository','DiscussionAccess','Target','Minimize','CommentRefresh']);
 }finally{f.close();}
});

test('a discussion reaction reuses its validated identity without a second target read',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),cap=await f.session();
 try{
  await expectJSON(await f.request('/api/v1/reaction',{config:{...f.config,number:d.number},id:'discussion',reaction:'HEART',add:true,key:key()},cap));
  assert.deepEqual(f.upstream.calls.filter(c=>c.operation).map(c=>c.operation),['Repository','DiscussionAccess','React']);
 }finally{f.close();}
});

test('repository identity pin rejects name reuse on access and combined reads, including after restart',async()=>{
 const f=fixture({seed:true});
 try{
  const config={...f.config,number:1};
  await f.engine.thread({request:{config},session:''});
  f.upstream.meta.id='R_replacement';
  await assert.rejects(f.engine.thread({request:{config},session:''}),error=>error.code==='PERMISSION');
  const restarted=new (f.engine.constructor)(f.env,f.store,f.upstream.fetch);
  const cap=await f.session();
  await assert.rejects(restarted.thread({request:{config},session:cap}),error=>error.code==='PERMISSION');
  assert.equal(JSON.parse([...f.sql.exec("SELECT value FROM records_v2 WHERE key='repository-id'")][0].value),'R_fixture');
 }finally{f.close();}
});

for (const policy of ['explicit','open']) test(`a validated rename under ${policy} policy keeps the pin and updates the alarm identity without warm pin reads`,async()=>{
 const f=fixture({seed:true});
 try{
  const renamed='example/renamed';
  if(policy==='explicit')f.env.REPOSITORIES[renamed]=f.env.REPOSITORIES['example/comments'];
  else f.env.OPEN_HOSTING={origins:'*',category:'Announcements'};
  const config={...f.config,number:1};await f.engine.thread({request:{config},session:''});
  f.upstream.meta.nameWithOwner=renamed;for(const d of f.upstream.discussions)d.repository.nameWithOwner=renamed;
  let pinReads=0;const exec=f.sql.exec;f.sql.exec=(sql,...args)=>{if(sql.startsWith('SELECT')&&args[0]==='repository-id')pinReads++;return exec(sql,...args);};
  const result=await f.engine.thread({request:{config:{...config,repo:renamed}},session:''});
  assert.equal(result.discussion.repository.nameWithOwner,renamed);assert.equal(pinReads,0);
  assert.equal(JSON.parse([...f.sql.exec("SELECT value FROM records_v2 WHERE key='identity'")][0].value).repo,renamed);
  assert.equal(JSON.parse([...f.sql.exec("SELECT value FROM records_v2 WHERE key='repository-id'")][0].value),'R_fixture');
 }finally{f.close();}
});

test('out-of-policy metadata cannot establish a repository pin',async()=>{
 const f=fixture({seed:true});
 try{
  f.upstream.meta.isPrivate=true;
  await assert.rejects(f.engine.thread({request:{config:{...f.config,number:1}},session:''}),error=>error.code==='PUBLIC_ONLY');
  assert.equal([...f.sql.exec("SELECT value FROM records_v2 WHERE key='repository-id'")].length,0);
  f.upstream.meta.isPrivate=false;
  await f.engine.thread({request:{config:{...f.config,number:1}},session:''});
  assert.equal(JSON.parse([...f.sql.exec("SELECT value FROM records_v2 WHERE key='repository-id'")][0].value),'R_fixture');
 }finally{f.close();}
});
