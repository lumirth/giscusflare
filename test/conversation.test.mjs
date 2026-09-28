import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON, core } from './fixtures.mjs';

async function conversation(f, cap, order='oldest', intercept) {
  const transport = {request: async (op, body) => {
    if (intercept) { const result=await intercept(op,body); if(result!==undefined)return result; }
    return expectJSON(await f.request('/api/v2/'+op,body,cap));
  }};
  const controller = new core.ConversationController(f.config,transport,order);
  await controller.refresh(); return controller;
}

test('posting to expanded replies keeps loaded replies, reveals the result and preserves order/drafts',async()=>{
  const f=fixture({seed:true});try{
    const cap=await f.session(); const c=await conversation(f,cap);
    const root=c.state.comments[0]; await c.loadReplies(root.id);
    assert.equal(c.state.comments[0].replies.items.length,7);
    c.setDraft('main','An unrelated unfinished thought');
    c.beginReply(root.id); c.setDraft('reply:'+root.id,'An eighth reply');
    const result=await c.submit('reply:'+root.id);
    assert.equal(result.comment.body,'An eighth reply');assert.equal(c.state.order,'oldest');
    assert.equal(c.state.comments[0].replies.items.length,8);assert.ok(c.state.expanded.has(root.id));
    assert.equal(c.draft(),'An unrelated unfinished thought');assert.equal(c.editors.size,0);
    await c.refresh();assert.equal(c.state.comments[0].replies.items.length,8);
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
   if(op==='comment'&&lose){lose=false;await expectJSON(await f.request('/api/v2/comment',body,cap));throw new Error('Network response lost');}
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
  const remaining=c.state.comments.find(x=>x.id===root.id);assert.equal(remaining.body,'');assert.equal(remaining.replies.items.length,7);
 }finally{f.close();}
});

test('reaction reconciliation does not reload thread or erase a draft',async()=>{
 const f=fixture({seed:true});try{
  const c=await conversation(f,await f.session());const root=c.state.comments[0];c.setDraft('main','Writing');
  const before=f.upstream.calls.filter(x=>x.operation==='Thread').length;
  await c.setReaction(root.id,'HEART',true);
  assert.equal(c.state.comments[0].reactions.HEART.selected,true);
  // Permission checks use minimal access fields; neither side reloads display content.
  assert.equal(f.upstream.calls.filter(x=>x.operation==='Thread').length,before);
  assert.equal(f.upstream.calls.filter(x=>x.operation==='DiscussionAccess').length,1);assert.equal(c.draft(),'Writing');
 }finally{f.close();}
});

test('stale read cannot overwrite a confirmed mutation',async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session();let release;let hold=false;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{
   if(op==='thread'&&hold){const stale=await expectJSON(await f.request('/api/v2/thread',body,cap));return new Promise(resolve=>{release=()=>resolve(stale);});}
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
 const c=await conversation(f,await f.session());c.replyPrefetch=100;await c.refresh();assert.equal(c.state.comments[0].replies.items.length,20);
 const calls=()=>f.upstream.calls.filter(x=>x.operation==='Replies').length;
 await c.revealReplies(root.id);assert.equal(c.state.visibleReplies.get(root.id),55);assert.equal(calls(),0);
 await c.revealReplies(root.id);assert.equal(calls(),1);
 await c.revealReplies(root.id);assert.equal(calls(),2);assert.equal(c.state.comments[0].replies.items.length,120);
 assert.equal(c.state.loadingReplies.size,0);await c.refresh();assert.equal(c.state.visibleReplies.get(root.id),155);
 assert.equal(c.state.comments[0].replies.items.length,120);
 }finally{f.close();}
});

test('rapid reaction changes are immediate, serialized, and retain the latest intent',async()=>{
 const f=fixture({seed:true});try{
  let release;let hold=true;let writes=0;
  const c=await conversation(f,await f.session(),'oldest',async(op)=>{if(op==='reaction'){writes++;if(hold){hold=false;await new Promise(r=>release=r);}}});
  const id=c.state.comments[0].id;
  const first=c.setReaction(id,'HEART',true);
  assert.equal(c.state.comments[0].reactions.HEART.count,1);
  const last=c.setReaction(id,'HEART',false);
  assert.equal(c.state.comments[0].reactions.HEART.selected,false);
  release();await Promise.all([first,last]);
  assert.equal(c.state.comments[0].reactions.HEART.count,0);assert.equal(writes,2);
  assert.equal(c.operationFor('reaction',id),undefined);
 }finally{f.close();}
});

test('reaction rejection rolls back; uncertain completion retains its receipt for explicit recovery',async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session();let failure='definite';let receipt;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{if(op!=='reaction')return;
   if(failure==='definite')throw Object.assign(new Error('Denied'),{status:403,code:'PERMISSION'});
   if(failure==='lost'){receipt=body.key;failure='recover';await expectJSON(await f.request('/api/v2/reaction',body,cap));throw new Error('Lost response');}
   assert.equal(body.key,receipt);
  });const id=c.state.comments[0].id;
  await assert.rejects(c.setReaction(id,'HEART',true),/Denied/);assert.equal(c.state.comments[0].reactions.HEART.selected,false);
  assert.equal(c.operationFor('reaction',id).status,'failed');
  failure='lost';await assert.rejects(c.setReaction(id,'HEART',true),/Lost/);assert.equal(c.operationFor('reaction',id).status,'uncertain');
  await c.retryReaction(id);assert.equal(c.state.comments[0].reactions.HEART.count,1);
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
 assert.throws(()=>fetchPolicy({staleAfterMs:-1}),RangeError);assert.throws(()=>fetchPolicy({replyPrefetch:101}),RangeError);
 let time=60_000,available=true,calls=0,success=false,release;
 const scheduler=new FetchScheduler(fetchPolicy(),async()=>{calls++;await new Promise(r=>release=r);return success;},()=>0,()=>available,()=>time);
 const work=scheduler.trigger('focus');await scheduler.trigger('focus');assert.equal(calls,1);release();await work;
 await scheduler.trigger('reconnect');assert.equal(calls,1);time+=5000;available=false;await scheduler.trigger('focus');assert.equal(calls,1);
 available=true;success=true;const again=scheduler.trigger('focus');release();await again;assert.equal(calls,2);

});

test('late published result from a previous identity cannot erase new writing or restore old viewer state',async()=>{
 const f=fixture({seed:true});try{
  let release;const c=await conversation(f,await f.session(),'oldest',async(op)=>{if(op==='comment')await new Promise(r=>release=r);});
  c.setDraft('main','Previous session');const pending=c.submit();c.changeIdentity();c.setDraft('main','New session writing');release();await pending;
  assert.equal(c.draft(),'New session writing');assert.equal(c.state.ready,false);assert.equal(c.state.comments.length,0);
 }finally{f.close();}
});

test('opening an edit starts from canonical text and reopening retains the unfinished edit',()=>{
 const model=new core.ConversationController(fixture().config,{request:async()=>({})});
 const comment={id:'C_edit',body:'Published text'};
 const name=model.beginEdit(comment);assert.equal(model.draft(name),'Published text');
 model.setDraft(name,'Unfinished revision');model.closeEditor(name);model.beginEdit({...comment,body:'A later read'});assert.equal(model.draft(name),'Unfinished revision');model.dispose();
});

test('ranked browser traversal hydrates bounded ID slices and does not crawl content pages',async()=>{
 const f=fixture({seed:true});try{
  const initial=await expectJSON(await f.request('/api/v2/thread',{config:f.config}));
  const base=initial.discussion.comments.nodes[0],ids=Array.from({length:45},(_,i)=>'DC_rank'+i),calls=[];
  const controller=new core.ConversationController(f.config,{request:async(op,body)=>{
   calls.push({op,body});
   if(op==='thread'){assert.equal(body.includeComments,false);return {...initial,profiles:['popular'],discussion:{...initial.discussion,comments:{...initial.discussion.comments,nodes:[]}},nextCursor:null};}
   if(op==='ranking')return{status:'ready',ids,observedAt:Date.now(),revision:1};
   if(op==='hydrate')return{comments:body.ids.filter(id=>id!=='DC_rank21').map(id=>({...structuredClone(base),id})),consumed:body.ids.length};
   throw Error(op);
  }},{profile:'popular'});
  await controller.refresh();assert.equal(controller.state.error,'');assert.equal(controller.state.comments.length,20);
  await controller.refresh(true);await controller.refresh(true);
  assert.deepEqual(controller.state.comments.map(c=>c.id),ids.filter(id=>id!=='DC_rank21'));
  assert.equal(calls.filter(c=>c.op==='ranking').length,1);assert.equal(calls.filter(c=>c.op==='thread').length,1);
  assert.deepEqual(calls.filter(c=>c.op==='hydrate').map(c=>c.body.ids.length),[20,20,5]);
  controller.setDraft('main','Keep writing');await controller.revalidate();assert.equal(controller.draft(),'Keep writing');assert.equal(calls.filter(c=>c.op==='ranking').length,1);
  controller.dispose();
 }finally{f.close();}
});

test('background revalidation retains content and drafts while foreground refresh still reports failures', async () => {
 const f=fixture({seed:true}); let fail=false;
 try {
  const c=await conversation(f,undefined,'oldest',async()=>{if(fail)throw new Error('Network unavailable');});
  const comments=c.state.comments, lastRefresh=c.state.lastRefresh;
  c.setDraft('main','Keep my writing'); fail=true;
  assert.equal(await c.revalidate(),false);
  assert.equal(c.state.error,''); assert.equal(c.state.comments,comments);
  assert.equal(c.state.lastRefresh,lastRefresh); assert.equal(c.draft(),'Keep my writing');
  await c.refresh(); assert.equal(c.state.error,'Network unavailable');
  assert.equal(await c.revalidate(),false);
  assert.equal(c.state.error,'Network unavailable','background work must not erase a foreground error');
  fail=false; assert.equal(await c.revalidate(),true); assert.equal(c.state.error,'');
  c.dispose();
 }finally{f.close();}
});

test('a foreground refresh joining background work still reports its failure', async () => {
 const f=fixture({seed:true}); let hold=false, reject;
 try {
  const c=await conversation(f,undefined,'oldest',async()=>{if(hold)return new Promise((_,no)=>{reject=no;});});
  hold=true; const background=c.revalidate(); const foreground=c.refresh();
  reject(new Error('Network unavailable')); assert.equal(await background,false); await foreground;
  assert.equal(c.state.error,'Network unavailable'); c.dispose();
 }finally{f.close();}
});


test('revalidation without an initial snapshot still exposes a load failure', async () => {
 const f=fixture();try{
  const c=new core.ConversationController(f.config,{request:async()=>{throw new Error('Network unavailable');}});
  assert.equal(await c.revalidate(),false);
  assert.equal(c.state.error,'Network unavailable'); assert.equal(c.state.ready,false); c.dispose();
 }finally{f.close();}
});

for (const kind of ['root','reply']) test(`delete response with a deleted ${kind} record removes the leaf immediately`,async()=>{
 const f=fixture({seed:true});try{
  const cap=await f.session('maintainer');let deleted;
  const c=await conversation(f,cap,'oldest',async(op,body)=>{
   if(op!=='delete')return;
   const result=await expectJSON(await f.request('/api/v2/delete',body,cap));
   return {...result,removed:undefined,comment:{...deleted,reactionGroups:Object.entries(deleted.reactions).map(([content,value])=>({content,users:{totalCount:value.count},viewerHasReacted:value.selected})),replyTo:deleted.replyToId?{id:deleted.replyToId}:null,body:'',bodyHTML:'',deletedAt:new Date(f.clock()).toISOString()}};
  });
  deleted=kind==='root'?c.state.comments.find(x=>x.replies.count===0):c.state.comments[0].replies.items[0];
  const roots=c.state.thread.commentCount,replies=c.state.comments[0].replies.count;
  await c.removeComment(deleted.id);
  assert.ok(!c.state.comments.some(x=>x.id===deleted.id||x.replies.items.some(r=>r.id===deleted.id)));
  if(kind==='root')assert.equal(c.state.thread.commentCount,roots-1);
  else assert.equal(c.state.comments[0].replies.count,replies-1);
  c.dispose();
 }finally{f.close();}
});


test('optimistic snapshots are reused and unrelated comments retain identity',async()=>{
 const f=fixture({seed:true});try{
  let release;
  const c=await conversation(f,await f.session(),'oldest',async op=>{if(op==='reaction')await new Promise(r=>release=r);});
  const before=c.state, untouched=before.comments[1];
  const pending=c.setReaction(before.comments[0].id,'HEART',true);
  const optimistic=c.state;
  assert.equal(c.state,optimistic);assert.equal(optimistic.comments[1],untouched);
  assert.notEqual(optimistic.comments[0],before.comments[0]);
  release();await pending;assert.equal(c.state.comments[1],untouched);
  assert.equal('view' in c.state,false);assert.equal('comments' in c.state.thread,false);
  c.dispose();
 }finally{f.close();}
});

test('recovered pre-release submission keeps uncertainty instead of receiving a new key',async()=>{
  const h=fixture();
  let writes=0;
  const controller=new core.ConversationController(h.config,{request:async()=>{writes++;throw new Error('must not submit');}});
  controller.restoreDrafts(JSON.stringify({drafts:[['main','Possibly posted']],keys:[['main','old-operation-key']]}));
  await assert.rejects(controller.submit(),/may already be on GitHub/);
  assert.equal(writes,0);assert.equal(controller.draft(),'Possibly posted');
  assert.equal(controller.operationFor('composer','main').status,'uncertain');
  assert.match(controller.serializeDrafts(),/old-operation-key/);
  controller.dispose();h.close();
});
