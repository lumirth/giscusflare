import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON, core } from './fixtures.mjs';

async function conversation(f, cap, order='oldest', intercept) {
  const transport = {request: async (op, body) => {
    if (intercept) { const result=await intercept(op,body); if(result!==undefined)return result; }
    return expectJSON(await f.request('/api/'+op,body,cap));
  }};
  const controller = new core.ConversationController(f.config,transport,order);
  await controller.refresh(); return controller;
}

test('posting to expanded replies keeps loaded replies, reveals the result and preserves order/drafts',async()=>{
  const f=fixture({seed:true});try{
    const cap=await f.session(); const c=await conversation(f,cap);
    const root=c.state.comments[0]; await c.loadReplies(root.id);
    assert.equal(c.state.comments[0].replies.nodes.length,7);
    c.setDraft('main','An unrelated unfinished thought');
    c.openEditor('reply:'+root.id,{kind:'reply',id:root.id,initial:''}); c.setDraft('reply:'+root.id,'An eighth reply');
    const result=await c.submit('reply:'+root.id);
    assert.equal(result.comment.body,'An eighth reply');assert.equal(c.state.order,'oldest');
    assert.equal(c.state.comments[0].replies.nodes.length,8);assert.ok(c.state.expanded.has(root.id));
    assert.equal(c.draft(),'An unrelated unfinished thought');assert.equal(c.editors.size,0);
    await c.refresh();assert.equal(c.state.comments[0].replies.nodes.length,8);
    c.dispose();
  }finally{f.close();}
});

test('successful roots preserve sort instead of forcing newest',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session());c.setDraft('main','Newest root');const r=await c.submit();
  assert.equal(c.state.order,'oldest');assert.equal(c.state.comments.at(-1).id,r.id);
 }finally{f.close();}
});

test('lost HTTP response retains submission key across reload, replay returns canonical result once',async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session();let lose=true;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{
   if(op==='comment'&&lose){lose=false;await expectJSON(await f.request('/api/comment',body,cap));throw new Error('Network response lost');}
  });c.setDraft('main','Saved despite network failure');await assert.rejects(c.submit(),/lost/);
  const saved=c.serializeDrafts();c.dispose();const restored=await conversation(f,cap);
  restored.restoreDrafts(saved);const result=await restored.submit();assert.equal(result.comment.body,'Saved despite network failure');
  assert.equal(f.upstream.discussions[0].comments.filter(c=>c.body==='Saved despite network failure').length,1);
 }finally{f.close();}
});

test('wiped parent remains in conversation with its replies',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session('maintainer'));const root=c.state.comments[0];
  await c.loadReplies(root.id);const result=await c.mutate('delete',{id:root.id});
  assert.ok(result.comment.deletedAt);assert.equal(result.removed,undefined);
  const remaining=c.state.comments.find(x=>x.id===root.id);assert.equal(remaining.body,'');assert.equal(remaining.replies.nodes.length,7);
 }finally{f.close();}
});

test('reaction reconciliation does not reload thread or erase a draft',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session());const root=c.state.comments[0];c.setDraft('main','Writing');
  const before=f.upstream.calls.filter(x=>x.operation==='Thread').length;
  await c.mutate('reaction',{id:root.id,reaction:'HEART',add:true});
  assert.equal(c.state.comments[0].reactionGroups.find(x=>x.content==='HEART').viewerHasReacted,true);
  // Backend validates current discussion; browser does not request another thread afterwards.
  assert.equal(f.upstream.calls.filter(x=>x.operation==='Thread').length,before+1);assert.equal(c.draft(),'Writing');
 }finally{f.close();}
});

test('stale read cannot overwrite a confirmed mutation',async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session();let release;let hold=false;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{
   if(op==='thread'&&hold){const stale=await expectJSON(await f.request('/api/thread',body,cap));return new Promise(resolve=>{release=()=>resolve(stale);});}
  });hold=true;const refreshing=c.refresh();while(!release)await new Promise(r=>setTimeout(r,0));
  c.setDraft('main','Must survive');const result=await c.submit();release();await refreshing;
  assert.ok(c.state.comments.some(x=>x.id===result.id));assert.equal(c.state.loading,false);
 }finally{f.close();}
});

test('moderation restores using restore permission and returns current state',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session('maintainer'));const root=c.state.comments[0];
  await c.mutate('moderate',{id:root.id,minimized:true,reason:'SPAM'});assert.ok(c.state.comments[0].isMinimized);
  await c.mutate('moderate',{id:root.id,minimized:false});assert.equal(c.state.comments[0].isMinimized,false);
 }finally{f.close();}
});

test('rotating credentials are removed before external refresh starts',async()=>{
 const f=fixture();try{
  const cap=await f.session('reader',{accessExpires:f.clock()});const key='session:'+await core.cryptography.hash(cap);
  const transport=async request=>{
   if(new URL(request.url).pathname==='/login/oauth/access_token')assert.equal(f.store.get(key,core.stored.EncryptedRecord),null);
   return f.upstream.fetch(request);
  };
  const engine=new core.RepositoryEngine(f.env,f.store,transport);
  await engine.thread({request:{config:f.config},session:cap});assert.equal(f.upstream.refreshes,1);
  assert.ok(f.store.get(key,core.stored.EncryptedRecord));
 }finally{f.close();}
});
