import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
await build({entryPoints:['src/browser/native.ts'],outfile:'dist/presentation-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const dom=new JSDOM('<!doctype html><div id="comments"></div>',{url:'https://blog.example/article',pretendToBeVisual:true});
for(const name of ['window','document','navigator','location','history','localStorage','sessionStorage','Node','Element','HTMLElement','HTMLTextAreaElement','HTMLAnchorElement','HTMLInputElement','HTMLImageElement','HTMLTableCellElement','HTMLOListElement','customElements','requestAnimationFrame'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.DOMParser=dom.window.DOMParser;globalThis.fetch=async()=>new Response(JSON.stringify({discussion:{id:'D_1',number:1,url:'https://github.com/example/comments/discussions/1',locked:false,closed:false,comments:{totalCount:0},reactionGroups:[]},viewer:null,archived:false,nextCursor:null}));
const {mountComments}=await import('../dist/presentation-test.mjs');
const config={repo:'example/comments',repoId:'',category:'Announcements',categoryId:'',origin:'https://blog.example/article',backLink:'',term:'article',number:0,strict:false,theme:'light',lang:'en',reactionsEnabled:true,emitMetadata:false,inputPosition:'bottom',description:''};
test('standard signed-out structure matches Giscus: bottom composer, one sign-in, upstream icons',async()=>{
 const target=document.getElementById('comments');const mounted=mountComments(target,{service:'https://comments.example',config});await new Promise(r=>setTimeout(r,20));
 const buttons=[...target.querySelectorAll('button')];assert.equal(buttons.filter(b=>b.textContent.trim()==='Sign in with GitHub'&&!b.closest('.gsc-reactions-menu')).length,1);
 assert.equal(target.querySelector('.gsc-main').lastElementChild.dataset.composer,'main');assert.equal(target.querySelector('textarea').disabled,true);assert.ok(target.querySelector('.btn-primary .octicon'));assert.ok(target.querySelector('.gsc-reactions-button svg.octicon'));assert.equal(target.querySelector('.gsc-reactions-popover p').textContent.trim(),'Sign in to add your reaction.');
 mounted.controller.setDraft('main','Retained draft');mounted.update({theme:'dark'});assert.equal(mounted.controller.draft(),'Retained draft');assert.equal(target.dataset.theme,'dark');
 mounted.update({term:'another'});assert.equal(mounted.config.term,'another');assert.equal(mounted.controller.draft(),'');mounted.dispose();mounted.dispose();assert.equal(target.children.length,0);
});


test('a replacement presentation retains its runtime and draft across appearance changes and owns its styling',async()=>{
 const {mountPresentation}=await import('../dist/presentation-test.mjs');
 const target=document.createElement('div');document.body.append(target);let mounts=0,updates=0,disposals=0;
 const custom={mount(host,runtime){mounts++;const input=document.createElement('textarea');host.append(input);return {update(config){updates++;host.dataset.customTheme=config.theme;},dispose(){disposals++;input.remove();}};}};
 const mounted=mountPresentation(target,{service:'https://comments.example',config},custom);
 const controller=mounted.controller;controller.setDraft('main','My own UI');const input=target.querySelector('textarea');input.focus();
 mounted.update({theme:'dark'});assert.equal(mounts,1);assert.equal(updates,1);assert.equal(mounted.controller,controller);assert.equal(controller.draft(),'My own UI');assert.equal(document.activeElement,input);assert.equal(target.className,'');assert.equal(target.querySelector('giscus-comments'),null);
 mounted.dispose();mounted.dispose();assert.equal(disposals,1);
});

test('standard composer remains connected and focused through reaction updates, preview and refresh',async()=>{
 const target=document.createElement('div');document.body.append(target);
 const mounted=mountComments(target,{service:'https://comments.example',config,draftRecovery:false});
 mounted.session.setSession('a'.repeat(43));await new Promise(r=>setTimeout(r,20));
 const textarea=target.querySelector('textarea'),form=textarea.closest('form');textarea.value='Unfinished writing';textarea.dispatchEvent(new window.Event('input'));textarea.focus();textarea.setSelectionRange(3,7);
 const records=[];const observer=new window.MutationObserver(items=>records.push(...items));observer.observe(target,{subtree:true,childList:true});
 await mounted.controller.refresh();await new Promise(r=>setTimeout(r,5));
 assert.equal(target.querySelector('textarea'),textarea);assert.equal(document.activeElement,textarea);assert.equal(textarea.selectionStart,3);
 assert.equal(records.some(r=>[...r.removedNodes].some(n=>n===form||n.contains?.(textarea))),false,'an update must never detach the editor or an ancestor');
 mounted.update({theme:'dark'});assert.equal(target.querySelector('textarea'),textarea);
 observer.disconnect();mounted.dispose();target.remove();
});

test('public composer binding supplies custom markup with preview cancellation and retained draft',async()=>{
 const {createConversation,bindComposer,browserDraftStore}=await import('../dist/presentation-test.mjs');
 const runtime=createConversation({service:'https://comments.example',config,draftRecovery:false});runtime.session.setSession('b'.repeat(43));
 const form=document.createElement('form'),textarea=document.createElement('textarea');form.append(textarea);document.body.append(form);
 const binding=bindComposer(runtime,'main',{form,textarea});textarea.value='A draft';textarea.dispatchEvent(new window.Event('input'));textarea.focus();
 const original=runtime.controller.preview.bind(runtime.controller);let complete;runtime.controller.preview=()=>new Promise(r=>complete=r);
 const work=binding.preview();binding.write();complete('<p>A draft</p>');await work;
 assert.equal(binding.state.mode,'write');assert.equal(binding.state.previewHTML,'');assert.equal(runtime.controller.draft(),'A draft');assert.equal(document.activeElement,textarea);
 runtime.controller.preview=original;binding.dispose();runtime.dispose();form.remove();
 const store=new Map();const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};let now=100;
 const recovery=browserDraftStore(300_000,()=>storage,()=>now);recovery.save('test','writing');assert.equal(recovery.load('test'),'writing');now+=300_001;assert.equal(recovery.load('test'),null);assert.equal(store.size,0);
});

test('standard parts are replaceable without taking ownership of session or controller',async()=>{
 const target=document.createElement('div');document.body.append(target);let updates=0,disposals=0;
 const mounted=mountComments(target,{service:'https://comments.example',config,draftRecovery:false},{reactions:()=>({element:document.createElement('aside'),update(){updates++;},dispose(){disposals++;}})});
 await new Promise(r=>setTimeout(r,10));const controller=mounted.controller;const part=target.querySelector('aside');
 mounted.update({theme:'dark'});assert.equal(mounted.controller,controller);assert.equal(target.querySelector('aside'),part);assert.ok(updates>1);assert.equal(target.querySelector('.gsc-reactions-menu'),null);
 mounted.dispose();assert.equal(disposals,1);target.remove();
});

test('changing a model draft updates custom composer markup without an unrelated refresh',async()=>{
 const {createConversation,bindComposer}=await import('../dist/presentation-test.mjs');
 const runtime=createConversation({service:'https://comments.example',config,draftRecovery:false});
 const form=document.createElement('form'),textarea=document.createElement('textarea');form.append(textarea);document.body.append(form);
 const binding=bindComposer(runtime,'main',{form,textarea});runtime.controller.setDraft('main','Externally restored text');assert.equal(textarea.value,'Externally restored text');binding.dispose();runtime.dispose();form.remove();
});

test('typing does not replace composer children, preserving WebKit undo grouping',async()=>{
 const target=document.createElement('div');document.body.append(target);
 const mounted=mountComments(target,{service:'https://comments.example',config,draftRecovery:false});mounted.session.setSession('c'.repeat(43));await new Promise(r=>setTimeout(r,20));
 const textarea=target.querySelector('textarea'), form=textarea.closest('form');
 const records=[];const observer=new window.MutationObserver(items=>records.push(...items));observer.observe(form,{subtree:true,childList:true});
 for(const letter of 'A complete phrase.'){textarea.value+=letter;textarea.dispatchEvent(new window.Event('input'));}
 await new Promise(r=>setTimeout(r,0));
 assert.equal(records.length,0,'even replacing sibling SVG nodes breaks WebKit native undo coalescing');
 observer.disconnect();mounted.dispose();target.remove();
});

test('initial load shows the Giscus animation without placeholder counts or editors',async()=>{
 const target=document.createElement('div');document.body.append(target);
 const original=globalThis.fetch;let release;
 globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({discussion:null,viewer:null,archived:false,nextCursor:null})));});
 const mounted=mountComments(target,{service:'https://comments.example',config,draftRecovery:false});
 assert.ok(target.querySelector('.gsc-loading-image'));assert.equal(target.querySelector('textarea'),null);assert.equal(target.querySelector('.gsc-comments-count'),null);
 await new Promise(r=>setTimeout(r,0));release();await new Promise(r=>setTimeout(r,20));
 assert.equal(target.querySelector('.gsc-loading-image'),null);assert.ok(target.querySelector('textarea'));
 mounted.dispose();target.remove();globalThis.fetch=original;
});
