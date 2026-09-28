import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('public website directs adoption to deployment and contains no hosted embed generator', async () => {
  const dom = new JSDOM(await readFile('website/index.html', 'utf8'));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('form').length, 0);
  assert.equal(doc.querySelectorAll('[data-design]').length, 2);
  const deploy = new URL(doc.querySelector('a.deploy').href);
  assert.equal(deploy.hostname, 'deploy.workers.cloudflare.com');
  assert.equal(deploy.searchParams.get('url'), 'https://github.com/lumirth/giscusflare');
  assert.match(doc.querySelector('.demo-context').textContent, /only be embedded on this website/);
  assert(doc.querySelector('.demo-context a').href.endsWith('/DEPLOY.md'));
  dom.window.close();
});

test('public demo bundles two designs of one configured discussion', async () => {
  const result = await build({ entryPoints: ['website/demo.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, define: { DEMO_ORIGIN: JSON.stringify('https://comments.example.com'), DEMO_NUMBER: '42' } });
  const script = result.outputFiles[0].text;
  assert.match(script, /https:\/\/comments.example.com/);
  assert(Object.keys(result.metafile.inputs).some(path => path.endsWith('/examples/forum.ts') || path === 'examples/forum.ts'));
  assert(!Object.keys(result.metafile.inputs).some(path => /node_modules\/(hono|valibot)/.test(path)));
  const source = await readFile('website/demo.ts', 'utf8');
  assert.equal((source.match(/createConversation\(/g) || []).length, 1);
  assert.match(source, /view\.dispose\(\)/);
  assert(!source.includes('runtime.dispose()'), 'Switching designs must retain the conversation.');
});
