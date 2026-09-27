// Read-only timing and contract check of the production display query.
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const code=await build({entryPoints:['src/domain/github.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {GitHub}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const requests=[];
const github=new GitHub('giscus/giscus',{}, {}, {},async request=>{
 const query=await request.text(),started=performance.now();
 const body=execFileSync('gh',['api','graphql','--input','-'],{input:query,maxBuffer:4*1024*1024});
 requests.push({wallMs:Math.round(performance.now()-started),bytes:body.length});
 return new Response(body);
});
for(const order of ['oldest','newest','oldest','newest']){
 const result=await github.thread(62,order,'','fixture-token-replaced-by-gh',true,5);
 Object.assign(requests.at(-1),{order,roots:result.comments.nodes.length,replies:result.comments.nodes.reduce((n,c)=>n+c.replies.nodes.length,0)});
}
const report={source:'Live GitHub giscus/giscus discussion62; production GitHub.thread query and response validation; gh authentication; local client elapsed time includes gh process and network',writes:0,requests};
if(process.env.PROOF_OUTPUT)await writeFile(process.env.PROOF_OUTPUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
