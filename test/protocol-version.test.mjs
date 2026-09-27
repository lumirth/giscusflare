import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, expectJSON, core, BLOG, SERVICE } from './fixtures.mjs';

for (const [method, path] of [['POST', '/api/thread'], ['GET', '/api/v2/thread']]) {
  test(`${method} ${path} asks an allowed native client to reload without invoking the repository`, async () => {
    const f = fixture();
    try {
      const response = await core.app.fetch(new Request(SERVICE + path, {
        method, headers: { Origin: BLOG, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ config: f.config }) } : {}),
      }), f.env);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), BLOG);
      const value = await expectJSON(response, 409);
      assert.equal(value.error.code, 'VERSION_MISMATCH');
      assert.equal(value.error.message, 'This comments page needs an update. Reload the page and try again.');
      assert.deepEqual(f.counts.rpc, []);
      assert.deepEqual(f.upstream.calls, []);
    } finally { f.close(); }
  });
}

test('retired protocol preflight is readable only by an admitted origin', async () => {
  const f = fixture();
  try {
    const request = origin => core.app.fetch(new Request(SERVICE + '/api/thread', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    }), f.env);
    const allowed = await request(BLOG);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), BLOG);
    const denied = await request('https://foreign.example');
    assert.equal((await expectJSON(denied, 403)).error.code, 'ORIGIN');
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    const direct = await core.app.fetch(new Request(SERVICE + '/api/v2/thread', { headers: { Origin: 'https://foreign.example' } }), f.env);
    assert.equal((await expectJSON(direct, 403)).error.code, 'ORIGIN');
    assert.deepEqual(f.counts.rpc, []);
  } finally { f.close(); }
});
