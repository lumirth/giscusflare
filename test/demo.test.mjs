import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
async function unusedPort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
test('demo serves assets and API routes with simulated GitHub',{timeout:15000},async()=>{
  const port=await unusedPort();let blog=await unusedPort();while(blog===port)blog=await unusedPort();
  const root=fileURLToPath(new URL('../',import.meta.url));let logs='';
  const child=spawn(process.execPath,['scripts/demo.mjs'],{cwd:root,env:{...process.env,PORT:String(port),BLOG_PORT:String(blog)},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{logs=(logs+b).slice(-5000);});
  const exited=once(child,'exit');const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;for(let i=0;i<100;i++){assert.equal(child.exitCode,null,logs);try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,logs);
    for(const path of ['/','/client.js','/widget.js','/widget.css','/auth-window.js','/auth-complete.js','/setup.js','/setup.css']){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.ok((await r.text()).length>50,path);}
    const r=await fetch(`http://127.0.0.1:${blog}/article`);assert.equal(r.status,200);assert.ok((await r.text()).includes(base+'/client.js'));
    assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,404);
  }finally{child.kill('SIGTERM');await exited;}
});
