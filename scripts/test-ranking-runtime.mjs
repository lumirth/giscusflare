import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory=await mkdtemp(join(tmpdir(),'giscusflare-ranking-runtime-'));
const compiled=await build({entryPoints:['scripts/ranking-runtime-worker.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const options=convertV4MiniflareOptions({name:'ranking-proof',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-25',durableObjects:{PROOF:{className:'RankingProof',useSQLite:true}}});
options.resourcePersistencePath=directory;options.telemetry={enabled:false};
let runtime=new Miniflare(options);
async function call(input){const response=await runtime.dispatchFetch('http://ranking-proof/',{method:'POST',body:JSON.stringify(input)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
try {
 const results={runtime:'native workerd SQLite via Miniflare',billingCpuMeasured:false};
 results.import10000=await call({name:'ten-thousand',action:'run',count:10000});assert.equal(results.import10000.count,10000);assert.equal(results.import10000.alarm,null);
 results.unchanged10000=await call({name:'ten-thousand',action:'run',count:10000,refresh:true});assert.equal(results.unchanged10000.count,10000);assert.equal(results.unchanged10000.candidateRowsWritten,0);
 results.steadyDay10000=await call({name:'ten-thousand',action:'steady',count:10000});assert.ok(results.steadyDay10000.budget.writes<=32000);assert.ok(results.steadyDay10000.writes<20000);assert.equal(results.steadyDay10000.alarm,null);
 await call({name:'mutations',action:'run',count:10000});
 results.steadyDayWith200Mutations=await call({name:'mutations',action:'steady',count:10000,mutations:200});
 assert.equal(results.steadyDayWith200Mutations.appliedMutations,200);assert.ok(results.steadyDayWith200Mutations.budget.writes<=32000);assert.ok(results.steadyDayWith200Mutations.writes<20000);assert.equal(results.steadyDayWith200Mutations.alarm,null);
 results.largeImportOrderLimitBytes=8*1024*1024;
 results.import100000=await call({name:'hundred-thousand',action:'run',count:100000,limits:{maxOrderBytes:8*1024*1024}});assert.equal(results.import100000.count,100000,JSON.stringify(results.import100000));assert.ok(results.import100000.windows.length>0);
 for(const result of [results.import10000,results.unchanged10000,results.import100000])for(const window of result.windows)assert.ok(window.budget.writes<=32000);
 await runtime.dispose();runtime=new Miniflare(options);
 results.restore10000=await call({name:'ten-thousand',action:'restore'});assert.deepEqual(results.restore10000,{count:10000,groups:79,reads:79,writes:0});
 results.restore100000=await call({name:'hundred-thousand',action:'restore'});assert.deepEqual(results.restore100000,{count:100000,groups:782,reads:782,writes:0});
 if(process.env.RANKING_PROOF_OUTPUT)await writeFile(process.env.RANKING_PROOF_OUTPUT,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results,null,2));
}finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
