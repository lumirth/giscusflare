import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/browser/setup-values.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { githubAppRegistration, configurationValues, sessionSecret } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('App registration uses this deployment and only needed permissions', () => {
  const url = new URL(githubAppRegistration('https://comments.example.com', 'https://example.com'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.get('callback_urls[]'), 'https://comments.example.com/auth/callback');
  assert.equal(url.searchParams.get('discussions'), 'write');
  assert.equal(url.searchParams.get('public'), 'true');
  assert.equal(url.searchParams.get('webhook_active'), 'false');
  assert.equal(url.searchParams.has('blocking'), false);
});
test('configuration distinguishes comments repository and website origin', () => {
  const values = configurationValues('https://comments.example.com', 'Owner/Comments', 'https://example.com/blog/', 'Announcements', '12345', 'Iv1.example');
  assert.deepEqual(values.REPOSITORIES['owner/comments'].origins, ['https://example.com']);
  assert.equal(values.PUBLIC_ORIGIN, 'https://comments.example.com');
  assert(!('GITHUB_PRIVATE_KEY' in values));
  assert.throws(() => configurationValues('https://comments.example.com', 'invalid', 'https://example.com', 'Announcements', '12345', 'Iv1.example'));
});
test('session keys are independent random 32-byte base64url values', () => {
  const first = sessionSecret(), second = sessionSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(Buffer.from(first, 'base64url').length, 32);
});

test('setup prepares Cloudflare values locally and verifies before emitting embed code', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFile } = await import('node:fs/promises');
  const compiled = await build({ entryPoints: ['src/browser/setup.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const dom = new JSDOM(await readFile('public/index.html', 'utf8'), { url: 'https://comments.example.com/', runScripts: 'outside-only' });
  const { window } = dom, calls = [];
  window.fetch = async url => {
    calls.push(String(url));
    return { ok: true, json: async () => String(url).includes('/config?') ? { repo: 'owner/comments', repoId: 'R_1', category: 'Announcements', categoryId: 'DIC_1' } : { configured: false } };
  };
  window.eval(compiled.outputFiles[0].text);
  const field = (form, name, value) => window.document.querySelector(`#${form} [name="${name}"]`).value = value;
  const submit = id => window.document.getElementById(id).dispatchEvent(new window.Event('submit', { cancelable: true }));
  field('app-form', 'website', 'https://example.com'); submit('app-form');
  const appLink = new URL(window.document.getElementById('app-link').href);
  assert.equal(appLink.searchParams.get('callback_urls[]'), 'https://comments.example.com/auth/callback');
  field('configuration-form', 'appId', '1234'); field('configuration-form', 'clientId', 'Iv1.example'); field('configuration-form', 'repo', 'Owner/Comments');
  submit('configuration-form');
  assert.match(window.document.getElementById('configuration-values').textContent, /owner\/comments/);
  window.document.getElementById('generate-secret').click();
  const secret = window.document.getElementById('session-secret').textContent;
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(calls.length, 1, 'Preparing settings must not send them to a server.');
  submit('setup-form');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1], 'https://comments.example.com').pathname, '/api/v2/config');
  assert(!calls.some(url => url.includes(secret)));
  assert.equal(window.document.getElementById('setup-result').hidden, false);
  assert.match(window.document.getElementById('setup-code').textContent, /src="https:\/\/comments.example.com\/client.js"/);
  dom.window.close();
});
