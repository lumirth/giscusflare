import test from'node:test';import assert from'node:assert/strict';import {core,fixture,expectJSON}from'./fixtures.mjs';
const key=()=>Date.now()+'.'+core.cryptography.random();
test('concurrent first comments create one discussion and preserve each author write',async()=>{
 const f=fixture(),cap=await f.session();await Promise.all(['one','two','three'].map(async body=>expectJSON(await f.request('/api/v1/comment',{config:f.config,body,key:key()},cap))));assert.equal(f.upstream.discussions.length,1);assert.equal(f.upstream.discussions[0].comments.length,3);assert.equal(f.upstream.calls.filter(c=>c.operation==='CreateDiscussion').length,1);f.close();
});
test('same mutation key returns a single receipt and rejects changed payloads',async()=>{
 const f=fixture(),cap=await f.session(),body={config:f.config,body:'once',key:key()};const responses=await Promise.all([f.request('/api/v1/comment',body,cap),f.request('/api/v1/comment',body,cap)]);assert.deepEqual(await expectJSON(responses[0]),await expectJSON(responses[1]));assert.equal(f.upstream.discussions[0].comments.length,1);await expectJSON(await f.request('/api/v1/comment',{...body,body:'different'},cap),409);f.close();
});
test('uncertain writes remain pending instead of being repeated',async()=>{
 const f=fixture();f.upstream.addThread('article');const cap=await f.session(),body={config:f.config,body:'may have committed',key:key()};f.upstream.failAfterMutation=true;await expectJSON(await f.request('/api/v1/comment',body,cap),502);const retry=await expectJSON(await f.request('/api/v1/comment',body,cap),409);assert.equal(retry.error.code,'WRITE_UNCERTAIN');assert.equal(f.upstream.discussions[0].comments.length,1);f.close();
});
test('uncertain creation cannot create a duplicate during search indexing delay',async()=>{
 const f=fixture(),cap=await f.session(),body={config:f.config,body:'wait',key:key()};f.upstream.failAfterMutation=true;f.upstream.hideSearch=true;await expectJSON(await f.request('/api/v1/comment',body,cap),502);await expectJSON(await f.request('/api/v1/comment',body,cap),409);assert.equal(f.upstream.discussions.length,1);f.upstream.hideSearch=false;await expectJSON(await f.request('/api/v1/comment',body,cap));assert.equal(f.upstream.discussions.length,1);f.close();
});
test('strict SHA-1 mapping reuses a preexisting discussion; explicit missing number never creates',async()=>{
 const f=fixture(),hash=await core.cryptography.sha1('article'),d=f.upstream.addThread('article',{body:'<!-- sha1: '+hash+' -->'}),cap=await f.session();await expectJSON(await f.request('/api/v1/comment',{config:{...f.config,strict:true},body:'existing',key:key()},cap));assert.equal(d.comments.length,1);assert.equal(f.upstream.discussions.length,1);await expectJSON(await f.request('/api/v1/comment',{config:{...f.config,number:99},body:'missing',key:key()},cap),404);assert.equal(f.upstream.discussions.length,1);f.close();
});
test('oldest/newest cursor pagination covers 47 comments without duplicates',async()=>{
 const f=fixture(),d=f.upstream.addThread('article');for(let i=0;i<47;i++)f.upstream.addComment(d,'Comment '+i);
 for(const order of ['oldest','newest']){let cursor='',ids=[];do{const data=await expectJSON(await f.request('/api/v1/thread',{config:f.config,order,cursor}));ids.push(...data.discussion.comments.nodes.map(c=>c.id));cursor=data.nextCursor;}while(cursor);assert.equal(ids.length,47);assert.equal(new Set(ids).size,47);}f.close();
});
test('reply pagination and reply-to-reply flattening stay within the mapped discussion',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),root=f.upstream.addComment(d,'root');for(let i=0;i<144;i++)f.upstream.addComment(d,'Reply '+i,{replyTo:root.id});const cap=await f.session();
 const initial=(await expectJSON(await f.request('/api/v1/thread',{config:f.config}))).discussion.comments.nodes[0].replies;let ids=initial.nodes.map(c=>c.id),cursor=initial.pageInfo.hasPreviousPage?initial.pageInfo.startCursor:null;
 while(cursor){const data=await expectJSON(await f.request('/api/v1/replies',{config:f.config,parentId:root.id,cursor}));ids.push(...data.nodes.map(c=>c.id));cursor=data.pageInfo.hasPreviousPage?data.pageInfo.startCursor:null;}assert.equal(ids.length,144);assert.equal(new Set(ids).size,144);
 await expectJSON(await f.request('/api/v1/comment',{config:f.config,replyToId:root.replies[0].id,body:'flattened',key:key()},cap));assert.equal(root.replies.length,145);
 const other=f.upstream.addThread('other'),outside=f.upstream.addComment(other,'outside');await expectJSON(await f.request('/api/v1/replies',{config:f.config,parentId:outside.id}),403);await expectJSON(await f.request('/api/v1/comment',{config:f.config,replyToId:outside.id,body:'wrong',key:key()},cap),403);f.close();
});
test('ownership, public visibility, category, archive and lock checks remain domain authorization',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),own=f.upstream.addComment(d,'own'),foreign=f.upstream.addComment(d,'foreign',{author:'visitor'}),cap=await f.session();
 await expectJSON(await f.request('/api/v1/edit',{config:f.config,id:own.id,body:'edited',key:key()},cap));assert.equal(own.body,'edited');await expectJSON(await f.request('/api/v1/edit',{config:f.config,id:foreign.id,body:'no',key:key()},cap),403);await expectJSON(await f.request('/api/v1/delete',{config:f.config,id:foreign.id,key:key()},cap),403);
 d.locked=true;await expectJSON(await f.request('/api/v1/comment',{config:f.config,body:'no',key:key()},cap),403);d.locked=false;
 f.upstream.meta.isPrivate=true;await expectJSON(await f.request('/api/v1/thread',{config:f.config}),403);f.upstream.meta.isPrivate=false;
 d.category.id='CAT_other';await expectJSON(await f.request('/api/v1/thread',{config:f.config}),403);d.category.id='CAT_fixture';
 f.upstream.meta.isArchived=true;await expectJSON(await f.request('/api/v1/comment',{config:f.config,body:'no',key:key()},cap),403);f.upstream.meta.isArchived=false;
 await expectJSON(await f.request('/api/v1/delete',{config:f.config,id:own.id,key:key()},cap));assert.equal(d.comments.length,1);f.close();
});
test('all eight reactions add/remove without invoking native upvote mutations',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),cap=await f.session();for(const reaction of ['THUMBS_UP','THUMBS_DOWN','LAUGH','HOORAY','CONFUSED','HEART','ROCKET','EYES'])for(const add of [true,false]){await expectJSON(await f.request('/api/v1/reaction',{config:f.config,id:'discussion',reaction,add,key:key()},cap));assert.deepEqual(d.votes[reaction],add?['reader']:[]);}assert.ok(!f.upstream.calls.some(c=>String(c.operation).includes('Upvote')));f.close();
});
test('moderation is permission checked and Markdown preview uses the user token',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),comment=f.upstream.addComment(d,'off topic'),reader=await f.session(),moderator=await f.session('maintainer');
 await expectJSON(await f.request('/api/v1/moderate',{config:f.config,id:comment.id,minimized:true,key:key()},reader),403);
 for(const minimized of [true,false]){await expectJSON(await f.request('/api/v1/moderate',{config:f.config,id:comment.id,minimized,key:key()},moderator));assert.equal(comment.isMinimized,minimized);}
 const preview=await expectJSON(await f.request('/api/v1/preview',{config:f.config,body:'**bold**'},reader));assert.equal(preview.html,'<p><strong>bold</strong></p>');f.close();
});
test('unexpected GitHub fields are tolerated but required safety data cannot silently disappear',async()=>{
 const f=fixture();f.upstream.addThread('article');f.upstream.corruptNext=data=>{data.repository.futureFeature='safe';return data;};await expectJSON(await f.request('/api/v1/thread',{config:f.config}));
 f.advance(60001);f.upstream.corruptNext=data=>{delete data.repository.isPrivate;return data;};const error=await expectJSON(await f.request('/api/v1/thread',{config:f.config}),502);assert.equal(error.error.code,'UPSTREAM_SCHEMA');assert.ok(!JSON.stringify(error).includes('futureFeature'));f.close();
});
test('unauthenticated writes are rejected before repository I/O',async()=>{
 const f=fixture();await expectJSON(await f.request('/api/v1/comment',{config:f.config,body:'no',key:key()}),401);assert.equal(f.counts.rpc.length,0);f.close();
});
test('discussion and account administration routes are absent',async()=>{
 const f=fixture();try{
   for(const route of ['/api/v1/discussion','/api/v1/block'])assert.equal((await f.request(route,{})).status,404);
   assert.equal(f.counts.rpc.length,0);
 }finally{f.close();}
});
test('a mapped discussion deleted on GitHub cannot silently recreate',async()=>{
 const f=fixture(),d=f.upstream.addThread('article'),cap=await f.session();try{
   await expectJSON(await f.request('/api/v1/thread',{config:f.config},cap));
   f.upstream.discussions.splice(f.upstream.discussions.indexOf(d),1);
   const view=await expectJSON(await f.request('/api/v1/thread',{config:f.config},cap));assert.equal(view.unavailable,true);
   await expectJSON(await f.request('/api/v1/comment',{config:f.config,body:'new',key:key()},cap),410);
   assert.equal(f.upstream.discussions.length,0);
 }finally{f.close();}
});
