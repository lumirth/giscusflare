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
    c.beginReply(root.id); c.setDraft('reply:'+root.id,'An eighth reply');
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
  await c.loadReplies(root.id);const result=await c.removeComment(root.id);
  assert.ok(result.comment.deletedAt);assert.equal(result.removed,undefined);
  const remaining=c.state.comments.find(x=>x.id===root.id);assert.equal(remaining.body,'');assert.equal(remaining.replies.nodes.length,7);
 }finally{f.close();}
});

test('reaction reconciliation does not reload thread or erase a draft',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session());const root=c.state.comments[0];c.setDraft('main','Writing');
  const before=f.upstream.calls.filter(x=>x.operation==='Thread').length;
  await c.setReaction(root.id,'HEART',true);
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
  await c.moderateComment(root.id,true,'SPAM');assert.ok(c.state.comments[0].isMinimized);
  await c.moderateComment(root.id,false);assert.equal(c.state.comments[0].isMinimized,false);
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


test('reply reveal is local in pages of 50 until the upstream buffer is exhausted',async()=>{
 const f=fixture();try{
 const d=f.upstream.addThread('article'),root=f.upstream.addComment(d,'root');
 for(let i=0;i<144;i++)f.upstream.addComment(d,'reply '+i,{replyTo:root.id});
 const c=await conversation(f,await f.session());c.replyPrefetch=100;await c.refresh();assert.equal(c.state.comments[0].replies.nodes.length,20);
 const calls=()=>f.upstream.calls.filter(x=>x.operation==='Replies').length;
 await c.revealReplies(root.id);assert.equal(c.state.visibleReplies.get(root.id),55);assert.equal(calls(),0);
 await c.revealReplies(root.id);assert.equal(calls(),1);
 await c.revealReplies(root.id);assert.equal(calls(),2);assert.equal(c.state.comments[0].replies.nodes.length,120);
 assert.equal(c.state.loadingReplies.size,0);await c.refresh();assert.equal(c.state.visibleReplies.get(root.id),155);
 assert.equal(c.state.comments[0].replies.nodes.length,120);
 }finally{f.close();}
});

test('rapid reaction changes are immediate, serialized, and retain the latest intent',async()=>{
 const f=fixture({seed:true});try{
  let release;let hold=true;let writes=0;
  const c=await conversation(f,await f.session(),'oldest',async(op)=>{if(op==='reaction'){writes++;if(hold){hold=false;await new Promise(r=>release=r);}}});
  const id=c.state.comments[0].id;
  const first=c.setReaction(id,'HEART',true);
  assert.equal(c.state.comments[0].reactionGroups.find(g=>g.content==='HEART').users.totalCount,1);
  const last=c.setReaction(id,'HEART',false);
  assert.equal(c.state.comments[0].reactionGroups.find(g=>g.content==='HEART').viewerHasReacted,false);
  release();await Promise.all([first,last]);
  assert.equal(c.state.comments[0].reactionGroups.find(g=>g.content==='HEART').users.totalCount,0);assert.equal(writes,2);
  assert.equal(c.operationFor('reaction',id),undefined);
 }finally{f.close();}
});

test('reaction rejection rolls back; uncertain completion retains its receipt for explicit recovery',async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session();let failure='definite';let receipt;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{if(op!=='reaction')return;
   if(failure==='definite')throw Object.assign(new Error('Denied'),{status:403,code:'PERMISSION'});
   if(failure==='lost'){receipt=body.key;failure='recover';await expectJSON(await f.request('/api/reaction',body,cap));throw new Error('Lost response');}
   assert.equal(body.key,receipt);
  });const id=c.state.comments[0].id;
  await assert.rejects(c.setReaction(id,'HEART',true),/Denied/);assert.equal(c.state.comments[0].reactionGroups.find(g=>g.content==='HEART').viewerHasReacted,false);
  assert.equal(c.operationFor('reaction',id).status,'failed');
  failure='lost';await assert.rejects(c.setReaction(id,'HEART',true),/Lost/);assert.equal(c.operationFor('reaction',id).status,'uncertain');
  await c.retryReaction(id);assert.equal(c.state.comments[0].reactionGroups.find(g=>g.content==='HEART').users.totalCount,1);
 }finally{f.close();}
});

test('cancel closes a reply without discarding writing; refreshes coalesce',async()=>{
 const f=fixture({seed:true});try{
  let reads=0;const c=await conversation(f,await f.session(),'oldest',op=>{if(op==='thread')reads++;});
  const id=c.state.comments[0].id,name=c.beginReply(id);c.setDraft(name,'Still here');c.closeEditor(name);
  assert.equal(c.editors.has(name),false);assert.equal(c.draft(c.beginReply(id)),'Still here');
  await Promise.all([c.refresh(),c.refresh(),c.refresh()]);assert.equal(reads,2);
 }finally{f.close();}
});

test('fetch policy is bounded, visible/online gated, deduplicated and backs off after failure',async()=>{
 const {fetchPolicy,FetchScheduler}=core;
 assert.throws(()=>fetchPolicy({pollIntervalMs:10}),RangeError);assert.throws(()=>fetchPolicy({replyPrefetch:101}),RangeError);
 let time=60_000,available=true,calls=0,success=false,release;
 const scheduler=new FetchScheduler(fetchPolicy(),async()=>{calls++;await new Promise(r=>release=r);return success;},()=>0,()=>available,()=>time);
 const work=scheduler.trigger('focus');await scheduler.trigger('focus');assert.equal(calls,1);release();await work;
 await scheduler.trigger('reconnect');assert.equal(calls,1);time+=5000;available=false;await scheduler.trigger('focus');assert.equal(calls,1);
 available=true;success=true;const again=scheduler.trigger('focus');release();await again;assert.equal(calls,2);
 await scheduler.trigger('poll');assert.equal(calls,2);
});

test('late published result from a previous identity cannot erase new writing or restore old viewer state',async()=>{
 const f=fixture({seed:true});try{
  let release;const c=await conversation(f,await f.session(),'oldest',async(op)=>{if(op==='comment')await new Promise(r=>release=r);});
  c.setDraft('main','Previous session');const pending=c.submit();c.changeIdentity();c.setDraft('main','New session writing');release();await pending;
  assert.equal(c.draft(),'New session writing');assert.equal(c.state.view,null);assert.equal(c.state.comments.length,0);
 }finally{f.close();}
});

test('opening an edit starts from canonical text and reopening retains the unfinished edit',()=>{
 const model=new core.ConversationController(fixture().config,{request:async()=>({})});
 const comment={id:'C_edit',body:'Published text'};
 const name=model.beginEdit(comment);assert.equal(model.draft(name),'Published text');
 model.setDraft(name,'Unfinished revision');model.closeEditor(name);model.beginEdit({...comment,body:'A later read'});assert.equal(model.draft(name),'Unfinished revision');model.dispose();
});
