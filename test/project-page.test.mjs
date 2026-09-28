import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('public website directs adoption to deployment and contains no hosted embed generator', async () => {
  const dom = new JSDOM(await readFile('website/index.html', 'utf8'));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('form').length, 0);
  const deploy = new URL(doc.querySelector('a.deploy').href);
  assert.equal(deploy.hostname, 'deploy.workers.cloudflare.com');
  assert.equal(deploy.searchParams.get('url'), 'https://github.com/lumirth/giscusflare');
  dom.window.close();
});

test('public demo bundles for the browser without server libraries', async () => {
  const result = await build({ entryPoints: ['website/demo.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, define: { DEMO_ORIGIN: JSON.stringify('https://comments.example.com'), DEMO_NUMBER: '42' } });
  assert(!Object.keys(result.metafile.inputs).some(path => /node_modules\/(hono|valibot)/.test(path)));
});
