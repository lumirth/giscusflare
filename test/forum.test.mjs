import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
await build({ stdin: { contents: "export { createConversation, createStandardPresentation } from './src/browser/native.ts'; export { forumPresentation } from './examples/forum.ts';", resolveDir: process.cwd() }, outfile: 'dist/forum-test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external' });
const dom = new JSDOM('<!doctype html><div id="comments"></div>', { url: 'https://example.com/demo', pretendToBeVisual: true });
for (const name of ['window','document','navigator','location','history','localStorage','sessionStorage','Node','Element','HTMLElement','HTMLTextAreaElement','HTMLAnchorElement','HTMLInputElement','HTMLImageElement','HTMLTableCellElement','HTMLOListElement','customElements','requestAnimationFrame','DOMParser']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
let requests = 0;
globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ discussion: { id: 'D_1', number: 1, url: 'https://github.com/example/comments/discussions/1', locked: false, closed: false, comments: { totalCount: 0 }, reactionGroups: [] }, viewer: null, archived: false, comments: [], nextCursor: null })); };
const { createConversation, createStandardPresentation, forumPresentation } = await import('../dist/forum-test.mjs');
const options = { service: 'https://comments.example.com', page: { repo: 'example/comments', origin: location.href, number: 1 }, appearance: { theme: 'light' }, draftRecovery: false };

test('design switches keep the conversation, draft and sign-in state without another read', async () => {
  const host = document.getElementById('comments');
  const runtime = createConversation(options); runtime.initialize({ session: 'a'.repeat(43) });
  await runtime.load();
  let view = createStandardPresentation().mount(host, runtime);
  runtime.setDraft('main', 'A draft between designs');
  const initialRequests = requests;
  view.dispose(); view = forumPresentation.mount(host, runtime);
  assert.equal(host.querySelector('textarea').value, 'A draft between designs');
  assert.equal(runtime.signedIn, true);
  assert.equal(requests, initialRequests);
  view.dispose(); view = createStandardPresentation().mount(host, runtime);
  assert.equal(host.querySelector('textarea').value, 'A draft between designs');
  assert.equal(requests, initialRequests);
  view.dispose(); runtime.dispose();
});

test('forum typing and refresh retain the editor node and selection', async () => {
  const host = document.getElementById('comments');
  const runtime = createConversation(options); runtime.initialize({ session: 'b'.repeat(43) }); await runtime.load();
  const view = forumPresentation.mount(host, runtime);
  const textarea = host.querySelector('textarea'), form = textarea.closest('form');
  const changes = [];
  const observer = new window.MutationObserver(records => changes.push(...records)); observer.observe(form, { childList: true, subtree: true });
  for (const letter of 'Keep writing') { textarea.value += letter; textarea.dispatchEvent(new window.Event('input')); }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(changes.length, 0, 'Typing must not replace preview or button children.');
  textarea.focus(); textarea.setSelectionRange(2, 6); await runtime.refresh();
  assert.equal(host.querySelector('textarea'), textarea); assert.equal(document.activeElement, textarea); assert.equal(textarea.selectionStart, 2);
  observer.disconnect(); view.dispose(); runtime.dispose();
});
