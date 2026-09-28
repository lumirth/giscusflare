import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
await build({entryPoints:['src/browser/content.ts'],outfile:'dist/content-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://blog.example'});
for(const name of ['window','document','DOMParser','Node','Element','HTMLElement','HTMLAnchorElement','HTMLImageElement','HTMLInputElement','HTMLTableCellElement','HTMLOListElement'])globalThis[name]=name==='window'?dom.window:name==='document'?dom.window.document:dom.window[name];
const {createContentRenderer}=await import('../dist/content-test.mjs');

test('content removes executable HTML and unsafe attributes, preserving rich structures',()=>{
 const result=createContentRenderer({math:'source'})('<script>alert(1)</script><svg onload="evil()"></svg><a href="javascript:evil()" onclick="evil()">bad</a><table><tr><td rowspan="2">cell</td></tr></table><input type="checkbox" checked><img src="https://example.com/a.png" onerror="evil()"><pre><code>hello</code></pre>');
 const container=document.createElement('div');container.append(result);
 assert.equal(container.querySelector('script,svg:not(.octicon),[onclick],[onerror]'),null);
 assert.ok(!container.querySelector('a').href.startsWith('javascript:'));
 assert.equal(container.querySelector('td').rowSpan,2);assert.equal(container.querySelector('input').disabled,true);
 assert.equal(container.querySelector('button').getAttribute('aria-label'),'Copy');assert.ok(container.querySelector('button svg.octicon'));assert.equal(container.querySelector('button svg').namespaceURI,'http://www.w3.org/2000/svg');
});

test('inline and display math use the full renderer after an alternate declines',async()=>{
 let calls=0;const result=createContentRenderer({math:async()=>{calls++;return null;}})('<p>Inline <math-renderer class="js-inline-math">x^2</math-renderer></p><math-renderer>\\frac{a}{b}</math-renderer>');
 const container=document.createElement('div');container.append(result);document.body.append(container);
 for(let i=0;i<100&&container.querySelector('[aria-busy]');i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(calls,2);assert.equal(container.querySelectorAll('math').length,2);
 assert.equal(container.querySelector('.giscus-math').dataset.display,'inline');
 assert.equal(container.querySelectorAll('math mfrac').length,1);
});

test('hostile math cannot create links or HTML execution; reduced mode keeps source',async()=>{
 const result=createContentRenderer()('<math-renderer>\\href{javascript:alert(1)}{hello}</math-renderer>');
 const node=document.createElement('div');node.append(result);
 for(let i=0;i<100&&node.querySelector('[aria-busy]');i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(node.querySelector('a,script,[href],[style],annotation-xml'),null);
 const reduced=createContentRenderer({math:'source',codeCopy:false})('<math-renderer>x^2</math-renderer>');assert.equal(reduced.textContent,'x^2');assert.equal(reduced.querySelector('[aria-busy]'),null);
});


test('GitHub math delimiters are removed before TeX conversion, not rendered as dollar glyphs',async()=>{
 const node=document.createElement('div');node.append(createContentRenderer()('<p><math-renderer class="js-inline-math">$E=mc^2$</math-renderer></p><math-renderer>$$\\frac{1}{3}$$</math-renderer>'));
 for(let i=0;i<100&&node.querySelector('[aria-busy]');i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(node.querySelectorAll('math').length,2);assert.ok(!node.textContent.includes('$'));assert.equal(node.querySelectorAll('mfrac').length,1);
});

test('custom code renderer gets plain source and language while failure retains readable code',async()=>{
 const seen=[];
 const node=document.createElement('div');
 node.append(createContentRenderer({code:async(source,language)=>{seen.push([source,language]);const f=document.createDocumentFragment();const code=document.createElement('code');code.textContent=source;f.append(code);return f;}})('<div class="highlight highlight-source-js"><pre><span class="pl-k">const</span> x = &lt;tag&gt;;</pre></div>'));
 await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(seen,[['const x = <tag>;','js']]);
 assert.equal(node.querySelector('pre'),null);assert.equal(node.querySelector('tag'),null);
 const fallback=document.createElement('div');fallback.append(createContentRenderer({code:async()=>{throw Error('offline');}})('<pre><code class="language-rust">fn main() {}</code></pre>'));
 await new Promise(r=>setTimeout(r,0));
 assert.match(fallback.querySelector('pre').textContent,/fn main/);assert.ok(fallback.querySelector('button'));
});

// Minimized from the GitHub bodyHTML of the giscus.app example comment.
const embeddedCode = `<div class="Box Box--condensed my-2"><div class="Box-header f6">
<p class="mb-0 text-bold"><a href="https://github.com/owner/repo/blob/abc/file.ts#L34">repo/file.ts</a></p>
<p class="mb-0 color-fg-muted">Line 34 in <a class="commit-tease-sha" href="/owner/repo/commit/abc">abc</a></p></div>
<div class="Box-body p-0 blob-wrapper blob-wrapper-embedded data"><table class="highlight tab-size mb-0 js-file-line-container" data-tab-size="8"><tbody><tr class="border-0">
<td class="blob-num border-0 tmp-px-3 py-0 color-bg-default" data-line-number="34"></td>
<td class="blob-code border-0 tmp-px-3 py-0 color-bg-default blob-code-inner js-file-line">  <span class="pl-k">return</span> true;</td>
</tr></tbody></table></div></div>`;
test('GitHub code previews retain their layout, line numbers, whitespace and commit links',()=>{
 const node=document.createElement('div');node.append(createContentRenderer()(embeddedCode));
 assert.ok(node.querySelector('.Box.Box--condensed > .Box-header'));
 assert.ok(node.querySelector('.blob-wrapper-embedded .blob-code-inner'));
 assert.equal(node.querySelector('.blob-num').dataset.lineNumber,'34');
 assert.equal(node.querySelector('.commit-tease-sha').href,'https://github.com/owner/repo/commit/abc');
 assert.equal(node.querySelector('.blob-code-inner').textContent,'  return true;');
 assert.equal(node.querySelector('.pl-k').textContent,'return');
 assert.equal(node.querySelector('button'),null);
});
test('malformed math shows an error and preserves the exact delimited source',async()=>{
 const node=document.createElement('div');node.append(createContentRenderer()('<math-renderer class="js-inline-math">$\\frac{broken$</math-renderer>'));
 for(let i=0;i<100&&node.querySelector('[aria-busy]');i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(node.querySelector('.math-render-error'));
 assert.equal(node.querySelector('.math-render-source').textContent,'$\\frac{broken$');
 assert.match(node.textContent,/Unable to render/);
 assert.equal(node.querySelector('math,merror'),null);
});
test('code copy stays outside the horizontal code scroller',()=>{
 const node=document.createElement('div');node.append(createContentRenderer()('<div class="highlight highlight-source-js"><pre>const longLine = 1;</pre></div>'));
 assert.ok(node.querySelector('.code-block > pre'));
 assert.ok(node.querySelector('.code-block > button.code-copy'));
 assert.equal(node.querySelector('pre button'),null);
});

test('rich markup does not admit arbitrary classes, attributes, or duplicate line IDs',()=>{
 const node=document.createElement('div');node.append(createContentRenderer()('<table class="blob-wrapper application-overlay" style="position:fixed" data-tab-size="999"><tr><td id="L1" class="blob-num" data-line-number="bad" onclick="evil()">one</td><td id="L1">two</td></tr></table><a href="#L1">line</a><a href="javascript:evil()">bad</a>'));
 assert.equal(node.querySelector('.application-overlay,[style],[onclick],[data-line-number]'),null);
 assert.equal(node.querySelectorAll('[id]').length,1);
 assert.equal(node.querySelector('a').getAttribute('href'),'#'+node.querySelector('[id]').id);
 assert.equal(node.querySelectorAll('a')[1].hasAttribute('href'),false);
});

test('copy reads the complete code without copying the button or losing line breaks',async()=>{
 let copied;Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async text=>{copied=text;}}},configurable:true});
 const node=document.createElement('div');node.append(createContentRenderer()('<pre><code>first line\n  second line</code></pre>'));
 node.querySelector('button').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(copied,'first line\n  second line');
 assert.equal(node.querySelector('button').getAttribute('aria-label'),'Copied!');
});
