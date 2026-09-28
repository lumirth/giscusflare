import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,expectJSON,REPO,core} from './fixtures.mjs';
const enable=f=>{f.env.REPOSITORIES[REPO].ranking={profiles:{popular:{weights:{THUMBS_UP:1},tieBreak:'oldest'}},maxAgeSeconds:300};};
test('optional ranking acquires only inputs and hydrates requested scoped root IDs',async()=>{
 const f=fixture();enable(f);try{
  const d=f.upstream.addThread('article');for(let i=0;i<45;i++)f.upstream.addComment(d,'Comment '+i);
  d.comments[30].votes.THUMBS_UP=['one','two'];
  const ranking=await expectJSON(await f.request('/api/v2/ranking',{config:f.config,profile:'popular'}));assert.equal(ranking.status,'ready',JSON.stringify(ranking));assert.equal(ranking.ids[0],d.comments[30].id);
  const hydrated=await expectJSON(await f.request('/api/v2/hydrate',{config:f.config,ids:ranking.ids.slice(0,20)}));assert.equal(hydrated.comments.length,20);assert.equal(hydrated.comments[0].id,ranking.ids[0]);
  const other=f.upstream.addThread('other'),outside=f.upstream.addComment(other,'outside');await expectJSON(await f.request('/api/v2/hydrate',{config:f.config,ids:[outside.id]}),403);
  assert.equal(f.upstream.calls.filter(c=>c.operation==='RankDiscovery').length,2);
  const cap=await f.session();await expectJSON(await f.request('/api/v2/reaction',{config:f.config,id:d.comments[0].id,reaction:'THUMBS_UP',add:true,key:Date.now()+'.'+crypto.randomUUID()},cap));
  const reordered=await expectJSON(await f.request('/api/v2/ranking',{config:f.config,profile:'popular'}));assert.equal(reordered.status,'ready');assert.equal(reordered.ids[1],d.comments[0].id);
 }finally{f.close();}
});
test('disabled ranking creates no ranking tables or upstream acquisition',async()=>{
 const f=fixture({seed:true});try{
  await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  await expectJSON(await f.request('/api/v2/ranking',{config:f.config,profile:'popular'}),400);
  assert.equal([...f.sql.exec("SELECT name FROM sqlite_master WHERE name LIKE 'ranking_%'")].length,0);
  assert.equal(f.upstream.calls.filter(c=>c.operation?.startsWith('Rank')).length,0);
 }finally{f.close();}
});

test('ready rankings reuse access checks and multiple discussion datasets until access expires',async()=>{
 const f=fixture({seed:true});enable(f);try{
  const other=f.upstream.addThread('other');f.upstream.addComment(other,'another');
  const a={config:f.config,profile:'popular'},b={config:{...f.config,term:'other'},profile:'popular'};
  await expectJSON(await f.request('/api/v2/ranking',a));
  await expectJSON(await f.request('/api/v2/ranking',b));
  const before=f.upstream.calls.length;
  let groupReads=0;const exec=f.sql.exec;f.sql.exec=(query,...args)=>{if(query.startsWith('SELECT number,generation,value FROM ranking_groups'))groupReads++;return exec(query,...args);};
  for(const input of [a,b,a,b])assert.equal((await expectJSON(await f.request('/api/v2/ranking',input))).status,'ready');
  assert.equal(f.upstream.calls.length,before);assert.equal(groupReads,0);
  f.upstream.meta.isPrivate=true;f.advance(60001);
  await expectJSON(await f.request('/api/v2/ranking',a),403);
 }finally{f.close();}
});
