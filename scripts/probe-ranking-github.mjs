// Read-only probe of production query builders against giscus's public demo.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const compiled=await build({entryPoints:['src/ranking/github.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {discoveryQuery,observationQuery,parseDiscovery,parseObservation}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const scope={repositoryId:'MDEwOlJlcG9zaXRvcnkzNTE5NTgwNTM=',discussionId:'MDEwOkRpc2N1c3Npb24zMzY2NDQ2',categoryId:'MDE4OkRpc2N1c3Npb25DYXRlZ29yeTMyNzk2NTc1'};
const inputs=['THUMBS_UP','HEART','replies','upvotes','answer'];
function call(query){const started=performance.now();const data=execFileSync('gh',['api','graphql','--input','-'],{input:JSON.stringify(query),maxBuffer:4*1024*1024});return {payload:JSON.parse(data),bytes:data.length,wallMs:Math.round(performance.now()-started)};}
const discovery=call(discoveryQuery(scope,null,inputs));const page=parseDiscovery(discovery.payload,scope,inputs);assert.equal(page.complete,true);assert.equal(page.candidates.length,100);assert.ok(page.cursor);
const ids=page.candidates.map(candidate=>candidate.id);
const observation=call(observationQuery(ids,inputs));const batch=parseObservation(observation.payload,ids,scope,inputs);assert.equal(batch.candidates.length,100);assert.deepEqual(batch.unresolved,[]);assert.deepEqual(batch.deleted,[]);
assert.deepEqual(batch.candidates.map(candidate=>candidate.id),ids);
const largeIds=[...ids];let cursor=page.cursor;
while(largeIds.length<800&&cursor){const next=call(discoveryQuery(scope,cursor,inputs));const page=parseDiscovery(next.payload,scope,inputs);assert.equal(page.complete,true);largeIds.push(...page.candidates.map(candidate=>candidate.id));cursor=page.cursor;}
const largeReaction=call(observationQuery(largeIds.slice(0,800),['THUMBS_UP']));const largeReactionResult=parseObservation(largeReaction.payload,largeIds.slice(0,800),scope,['THUMBS_UP']);assert.equal(largeReactionResult.candidates.length,800);assert.deepEqual(largeReactionResult.unresolved,[]);
const largeFull=call(observationQuery(largeIds.slice(0,500),inputs));const largeFullResult=parseObservation(largeFull.payload,largeIds.slice(0,500),scope,inputs);assert.equal(largeFullResult.candidates.length,500);assert.deepEqual(largeFullResult.unresolved,[]);
const report={largeReaction:{count:800,bytes:largeReaction.bytes,wallMs:largeReaction.wallMs},largeFull:{count:500,bytes:largeFull.bytes,wallMs:largeFull.wallMs},scope:'giscus/giscus discussion 62',inputs,discovery:{count:page.candidates.length,bytes:discovery.bytes,wallMs:discovery.wallMs,newestFirst:page.candidates.every((item,index)=>index===0||item.created<=page.candidates[index-1].created)},observation:{count:batch.candidates.length,bytes:observation.bytes,wallMs:observation.wallMs},writes:0};assert.equal(report.discovery.newestFirst,true);
if(process.env.RANKING_PROOF_OUTPUT)await writeFile(process.env.RANKING_PROOF_OUTPUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
