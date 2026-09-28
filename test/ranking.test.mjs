import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'giscusflare-ranking-'));
await build({entryPoints:['src/ranking/engine.ts','src/ranking/order.ts','src/ranking/types.ts','src/ranking/github.ts'],outdir:dir,bundle:true,format:'esm',platform:'node',outExtension:{'.js':'.mjs'}});
const { RankingEngine } = await import(join(dir,'engine.mjs'));
const { order, traversalPage } = await import(join(dir,'order.mjs'));
const { DEFAULT_RANKING_LIMITS } = await import(join(dir,'types.mjs'));
const { discoveryQuery, observationQuery, parseDiscovery, parseObservation } = await import(join(dir,'github.mjs'));
await rm(dir,{recursive:true,force:true});
const options = { ...DEFAULT_RANKING_LIMITS, profiles: { popular: { weights:{THUMBS_UP:1},tieBreak:'oldest' } } };
const candidate = (id, value=0, created=1) => ({id,created,eligible:true,values:{THUMBS_UP:value}});
function fixture(records=[], overrides={}) {
 let now=1_800_000_000_000;
 const db = new DatabaseSync(':memory:');
 const metrics={queries:[],candidateWrites:0};
 const sql={exec(query,...bindings){metrics.queries.push(query);if(/^(INSERT INTO|UPDATE|DELETE FROM) ranking_groups/.test(query))metrics.candidateWrites++;return db.prepare(query).all(...bindings);}};
 const storage={sql,transactionSync(action){db.exec('BEGIN');try{const value=action();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const config={...options,...overrides};
 let engine=new RankingEngine(storage,config,()=>now),calls=0;
 const source={
  async discover(cursor){calls++;const start=cursor===null?0:Number(cursor);const candidates=records.slice(start,start+100);return {candidates:structuredClone(candidates),cursor:start+100<records.length?String(start+100):null,complete:true};},
  async observe(ids){calls++;return {candidates:structuredClone(records.filter(item=>ids.includes(item.id))),deleted:ids.filter(id=>!records.some(item=>item.id===id))};},
 };
 return {db,sql,storage,metrics,source,records,get engine(){return engine;},restart(next=config){engine=new RankingEngine(storage,next,()=>now);},now:()=>now,advance(ms){now+=ms;},calls:()=>calls};
}
async function ready(f,profile='popular',maximum=1000){for(let i=0;i<maximum;i++){const result=await f.engine.request('thread',profile,f.source);if(result.status!=='preparing')return result;f.advance(Math.max(1,result.retryAt-f.now()));}throw Error('Preparation did not finish');}

test('complete deterministic ranking preserves decreases and traversal consumes deleted positions',()=>{
 const data=[candidate('b',3,1),candidate('a',3,1),candidate('c',2,2)];
 assert.deepEqual(order(data,options.profiles.popular,1024),['a','b','c']);
 const first=order(data,options.profiles.popular,1024);data[0].values.THUMBS_UP=0;
 assert.deepEqual(order(data,options.profiles.popular,1024),['a','c','b']);
 assert.deepEqual(traversalPage(first,1,2),{ids:['b','c'],next:3});
 assert.throws(()=>order([{...candidate('a'),values:{}}],options.profiles.popular,1024),/INPUTS/);
 assert.throws(()=>traversalPage(first,0,51));
});
test('first acquisition never publishes a partial set and leaves no idle alarm',async()=>{
 const f=fixture(Array.from({length:450},(_,i)=>candidate('id'+i,i,450-i)));
 const first=await f.engine.request('thread','popular',f.source);assert.equal(first.status,'preparing');
 const result=await ready(f);assert.equal(result.status,'ready');assert.equal(result.ids.length,450);assert.equal(result.ids[0],'id449');assert.equal(f.engine.nextAlarmAt(),null);
 const calls=f.calls();await ready(f);assert.equal(f.calls(),calls);f.db.close();
});
test('10000 candidates use fewer than 100 storage groups and survive a new engine',async()=>{
 const f=fixture(Array.from({length:10000},(_,i)=>candidate('id'+i,i,10000-i)));
 const result=await ready(f);assert.equal(result.status,'ready');assert.equal(result.ids.length,10000);
 assert.ok(f.db.prepare('SELECT COUNT(*) n FROM ranking_groups').get().n<100);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ranking_locations').get().n,10000);
 f.restart();assert.deepEqual((await ready(f)).ids,result.ids);f.db.close();
});
test('unchanged counter refresh writes no candidate groups',async()=>{
 const f=fixture(Array.from({length:1000},(_,i)=>candidate('id'+i,i)));
 await ready(f);const writes=f.metrics.candidateWrites;f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);assert.equal((await ready(f)).status,'ready');assert.equal(f.metrics.candidateWrites,writes);f.db.close();
});
test('a mutation fences an older refresh and partial counters preserve stable fields',async()=>{
 const f=fixture([candidate('a',1),candidate('b',2)]);await ready(f);f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 const observe=f.source.observe;let changed=false;
 f.source.observe=async ids=>{const result=await observe(ids);if(!changed){changed=true;f.records[0].values.THUMBS_UP=9;f.engine.observePartial('thread','a',{THUMBS_UP:9});}return result;};
 const result=await ready(f);assert.equal(result.status,'ready');assert.equal(result.ids[0],'a');assert.equal(f.engine.store.candidate('thread','a').values.THUMBS_UP,9);f.db.close();
});
test('newest catchup reaches the completed fence past a locally inserted root',async()=>{
 const f=fixture([candidate('old',1)]);await ready(f);
 f.records.unshift(candidate('external',4,2));f.records.unshift(candidate('local',2,3));f.engine.observeMutation('thread',f.records[0]);f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 assert.deepEqual((await ready(f)).ids,['external','local','old']);f.db.close();
});
test('deleted candidates do not shift observation progress past remaining groups',async()=>{
 const f=fixture(Array.from({length:1500},(_,i)=>candidate('id'+i,i)));
 await ready(f);f.records.splice(300,400);for(const record of f.records)record.values.THUMBS_UP+=1;f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 const result=await ready(f);assert.equal(result.status,'ready');assert.equal(result.ids.length,1100);assert.equal(f.engine.store.candidate('thread','id1499').values.THUMBS_UP,1500);f.db.close();
});
test('new required inputs cannot be published before backfill',async()=>{
 const f=fixture([candidate('a',1)]);await ready(f);
 f.restart({...options,profiles:{popular:options.profiles.popular,answers:{weights:{answer:1},tieBreak:'oldest'}}});
 const first=await ready(f,'answers');assert.notEqual(first.status,'ready');
 f.records[0].values.answer=1;f.advance(60001);assert.equal((await ready(f,'answers')).status,'ready');f.db.close();
});
test('reservations survive restart and acquisition pauses before the daily budget',async()=>{
 const f=fixture(Array.from({length:300},(_,i)=>candidate('id'+i,i)),{maxRowsWrittenPerDay:300});
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'budget');const calls=f.calls();f.restart();assert.equal((await ready(f)).status,'paused');assert.equal(f.calls(),calls);
 assert.ok(f.engine.store.budget().writes<=300);f.db.close();
});
test('failed observations do not prove deletion or publish incomplete ranking',async()=>{
 const f=fixture([candidate('a',1)]);await ready(f);f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);f.source.observe=async()=>({candidates:[],deleted:[],unresolved:['a']});
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'inputs');assert.equal(f.engine.store.candidate('thread','a').id,'a');f.db.close();
});
test('oldest observation controls freshness instead of the completion timestamp',async()=>{
 const f=fixture(Array.from({length:1000},(_,i)=>candidate('id'+i,i)),{maxAgeSeconds:1});
 const original=f.source.observe;f.source.observe=async ids=>{const result=await original(ids);f.advance(2000);return result;};
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'freshness');assert.equal(f.engine.nextAlarmAt(),null);f.db.close();
});
test('observation query batches 100 IDs per alias and requests only selected inputs',()=>{
 const query=observationQuery(Array.from({length:800},(_,i)=>'id'+i),['THUMBS_UP']);assert.equal(Object.keys(query.variables).length,8);assert.match(query.query,/reactors \{ totalCount \}/);assert.doesNotMatch(query.query,/body|replies|upvoteCount/);assert.throws(()=>observationQuery(['a','a'],['THUMBS_UP']));
 const discovery=discoveryQuery({repositoryId:'R',discussionId:'D'},null,['replies']);assert.match(discovery.query,/last:100,before/);assert.doesNotMatch(discovery.query,/reactionGroups/);
});
test('GraphQL error paths retain complete records and never turn an errored null into deletion',()=>{
 const scope={repositoryId:'R',discussionId:'D',categoryId:'C'};
 const node={id:'a',createdAt:'2026-01-01T00:00:00Z',isMinimized:false,replyTo:null,discussion:{id:'D',repository:{id:'R',isPrivate:false},category:{id:'C'}},reactionGroups:[{content:'THUMBS_UP',reactors:{totalCount:2}}]};
 const result=parseObservation({data:{batch0:[node,null,null]},errors:[{path:['batch0',1,'reactionGroups']}]},['a','b','c'],scope,['THUMBS_UP']);
 assert.deepEqual(result.candidates.map(record=>record.id),['a']);assert.deepEqual(result.unresolved,['b']);assert.deepEqual(result.deleted,['c']);
 assert.throws(()=>parseObservation({data:{batch0:[{...node,replyTo:{id:'root'}}]}},['a'],scope,['THUMBS_UP']),/scope|discussion/);
 const page=parseDiscovery({data:{node:{...node.discussion,comments:{nodes:[node],pageInfo:{hasPreviousPage:false,startCursor:null}}}}},scope,['THUMBS_UP']);assert.equal(page.complete,true);assert.equal(page.candidates[0].values.THUMBS_UP,2);
});
test('permanent upstream failure stops unattended retries until new demand',async()=>{
 const f=fixture([candidate('a')]);f.source.discover=async()=>{throw Error('Permission removed');};
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'upstream');assert.equal(f.engine.nextAlarmAt(),null);f.db.close();
});
test('an explicit invalidation fences a returning acquisition before publication',async()=>{
 const f=fixture([candidate('a',1)]);await ready(f);f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 const original=f.source.observe;let first=true;
 f.source.observe=async ids=>{const result=await original(ids);if(first){first=false;f.engine.invalidate('thread');f.records.push(candidate('new',9,2));}return result;};
 const result=await ready(f);assert.equal(result.status,'ready');assert.equal(result.ids[0],'new');f.db.close();
});
test('cold own creation invalidates membership and a restart retains the new scope',async()=>{
 const f=fixture([candidate('a',1)]);await ready(f);f.restart();f.records.unshift(candidate('b',9,2));f.engine.observeMutation('thread',f.records[0]);f.restart();
 assert.deepEqual((await ready(f)).ids,['b','a']);f.db.close();
});
test('a larger operator age setting releases an infeasible freshness pause',async()=>{
 const f=fixture(Array.from({length:1000},(_,i)=>candidate('id'+i,i)),{maxAgeSeconds:1});
 const observe=f.source.observe;f.source.observe=async ids=>{const result=await observe(ids);f.advance(2000);return result;};
 assert.equal((await ready(f)).reason,'freshness');f.restart({...options,maxAgeSeconds:300});assert.equal((await ready(f)).status,'ready');f.db.close();
});
test('missing discovery fence triggers a complete audit and removes absent roots',async()=>{
 const f=fixture([candidate('first',1),candidate('second',2),candidate('third',3)]);await ready(f);f.records.shift();f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 assert.deepEqual((await ready(f)).ids,['third','second']);f.db.close();
});
test('daily audit repairs external deletion even when the newest fence survives',async()=>{
 const f=fixture([candidate('first',1),candidate('second',2)]);await ready(f);f.records.pop();f.advance(86400001);
 assert.deepEqual((await ready(f)).ids,['first']);f.db.close();
});
test('budget exhaustion leaves successful canonical writes usable and invalidates derived coverage',async()=>{
 const f=fixture([candidate('a',1),candidate('b',2)]);await ready(f);
 f.engine.store.reserve({reads:0,writes:options.maxRowsWrittenPerDay-f.engine.store.budget().writes-33,requests:0});
 f.engine.observePartial('thread','a',{THUMBS_UP:10});
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'budget');f.db.close();
});
test('overlapping demand joins one acquisition instead of duplicating the import',async()=>{
 const f=fixture([candidate('a',1)]);let release;
 const gate=new Promise(resolve=>{release=resolve;});const discover=f.source.discover;let calls=0;
 f.source.discover=async cursor=>{calls++;await gate;return discover(cursor);};
 const first=f.engine.request('thread','popular',f.source),second=f.engine.request('thread','popular',f.source);release();
 const results=await Promise.all([first,second]);assert.equal(results[0].status,'ready');assert.equal(results[1].status,'ready');assert.equal(calls,2);f.db.close();
});
test('interleaved threads restore the right dataset after an awaited observation',async()=>{
 const f=fixture([candidate('a',1),candidate('b',2)]);await ready(f);f.advance((DEFAULT_RANKING_LIMITS.maxAgeSeconds+1)*1000);
 const original=f.source.observe;let changed=false;f.source.observe=async ids=>{const result=await original(ids);if(!changed){changed=true;await f.engine.request('other','popular',f.source);f.engine.observePartial('thread','a',{THUMBS_UP:9});f.records[0].values.THUMBS_UP=9;}return result;};
 assert.equal((await ready(f)).ids[0],'a');assert.equal(f.engine.store.candidate('thread','a').values.THUMBS_UP,9);f.db.close();
});
test('opaque ID response limits stop preparation instead of truncating an order',async()=>{
 const f=fixture(Array.from({length:100},(_,i)=>candidate('a'.repeat(100)+i,i)),{maxOrderBytes:1024});
 const result=await ready(f);assert.equal(result.status,'paused');assert.equal(result.reason,'size');assert.equal(f.engine.nextAlarmAt(),null);f.db.close();
});
test('all selected scalar inputs are validated and malformed/foreign records are refused',()=>{
 const scope={repositoryId:'R',discussionId:'D'};
 const base={id:'a',createdAt:'2026-01-01T00:00:00Z',isMinimized:false,replyTo:null,discussion:{id:'D',repository:{id:'R',isPrivate:false},category:{id:'C'}},replies:{totalCount:3},upvoteCount:2,isAnswer:true};
 assert.deepEqual(parseObservation({data:{batch0:[base]}},['a'],scope,['replies','upvotes','answer']).candidates[0].values,{replies:3,upvotes:2,answer:1});
 for(const wrong of [{id:'foreign'},{discussion:{...base.discussion,repository:{id:'R',isPrivate:true}}},{discussion:{...base.discussion,id:'other'}}])assert.throws(()=>parseObservation({data:{batch0:[{...base,...wrong}]}},['a'],scope,['upvotes']));
 assert.deepEqual(parseObservation({data:{batch0:[{...base,upvoteCount:null}]}},['a'],scope,['upvotes']).unresolved,['a']);
});
test('permission failure stops immediately and a provider cooldown never splits or retries early',async()=>{
 const f=fixture([candidate('a')]);let calls=0;
 f.source.discover=async()=>{calls++;throw Object.assign(Error('Not allowed'),{code:'PERMISSION'});};
 const denied=await ready(f);assert.equal(denied.reason,'upstream');assert.equal(calls,1);assert.equal(f.engine.nextAlarmAt(),null);
 f.advance(60001);f.source.discover=async()=>{calls++;throw Object.assign(Error('Rate limited'),{code:'RATE_LIMIT',retryAfter:120});};
 const limited=await ready(f);assert.equal(limited.reason,'upstream');assert.equal(limited.retryAt,f.now()+120000);const before=calls;
 await f.engine.continueJobs(()=>f.source);assert.equal(calls,before);f.db.close();
});
