import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rateBindings } from './rate-bindings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(root, 'docs/evidence');
await mkdir(evidence, { recursive: true });
const report = { name: 'native-workerd', status: 'not-run', github: 'local test-only simulation', checks: [], details: '' };
let child; let directory; let output = ''; let runningFailure;
const tests = [];
async function check(name, run) { await run(); const entry = { name, status: 'passed' }; tests.push(entry); console.log('PASS', name); }
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit').catch(() => {});
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await Promise.race([done, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
try {
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  await access(wrangler);
  directory = await mkdtemp(resolve(root, '.runtime-test-'));
  const port = Number(process.env.RUNTIME_TEST_PORT || 18790);
  const origin = `http://127.0.0.1:${port}`;
  const blog = `http://127.0.0.1:${port + 1}`;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const entry = resolve(directory, 'entry.mjs');
  await build({ absWorkingDir: root, entryPoints: ['test/runtime-entry.ts'], outfile: entry, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'], logLevel: 'warning' });
  const rates = await rateBindings([
    { name: 'READ_LIMITER', namespace_id: '84101', simple: { limit: 120, period: 60 } },
    { name: 'WRITE_LIMITER', namespace_id: '84102', simple: { limit: 30, period: 60 } },
    { name: 'AUTH_LIMITER', namespace_id: '84103', simple: { limit: 15, period: 60 } },
    { name: 'TEST_LIMITER', namespace_id: '84104', simple: { limit: 3, period: 60 } }
  ]);
  const fixtureModule = await import('../test/fixtures.mjs');
  const fixtureFactory = fixtureModule.fixture || fixtureModule.createFixture;
  const localFixture = await fixtureFactory();
  const identity = localFixture.env;
  localFixture.close?.();
  const config = {
    name: 'giscus-v2-runtime-test', main: entry, compatibility_date: '2026-09-25',
    assets: { directory: resolve(root, 'public'), binding: 'ASSETS', run_worker_first: ['/api/*','/auth/*','/widget','/*/widget','/healthz','/__test/*'] },
    durable_objects: { bindings: [{ name: 'REPOSITORY_STORE', class_name: 'Repository' }, { name: 'PROBE', class_name: 'Probe' }] },
    migrations: [{ tag: 'test-initial', new_sqlite_classes: ['Repository','Probe'] }], ...rates,
    vars: {
      PUBLIC_ORIGIN: origin, GITHUB_APP_ID: identity.GITHUB_APP_ID, GITHUB_CLIENT_ID: identity.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: identity.GITHUB_CLIENT_SECRET, GITHUB_PRIVATE_KEY: pem,
      SESSION_SECRET: randomBytes(32).toString('base64url'),
      REPOSITORIES: { 'example/comments': { origins: [blog], category: 'Announcements', defaultCommentOrder: 'oldest', customThemeOrigins: [] } }
    }, observability: { enabled: false }
  };
  // Store test credentials in a private temporary directory.
  const configPath = resolve(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const persistence = resolve(directory, 'sqlite');
  const launch = async () => {
    child = spawn(process.execPath, [wrangler, 'dev', '--config', configPath, '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistence], {
      cwd: root, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }
    });
    child.on('error', error => { runningFailure = error; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-100000); });
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      if (runningFailure) throw runningFailure;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Wrangler stopped before startup.');
      try { const r = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('workerd startup timed out.');
  };
  const request = (path, body, session = '') => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json', Origin: origin }), ...(session ? { Authorization: 'Bearer ' + session } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
  });
  const decode = async response => { const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; };
  const widget = { repo:'example/comments', origin:blog+'/article', term:'article', category:'Announcements' };
  await launch();
  await check('Hono handles requests in workerd', async () => { const r = await request('/healthz'); assert.equal(r.status,200); });
  await check('ASSETS serves static files', async () => { const r=await request('/client.js'); assert.equal(r.status,200); assert.match(await r.text(),/giscus/); });
  await check('widget HTML has the configured frame boundary', async () => { const r=await request('/widget?'+new URLSearchParams(widget));assert.equal(r.status,200);assert.ok(r.headers.get('Content-Security-Policy').includes(blog)); });
  await check('Valibot rejects malformed JSON before a repository operation', async () => { const r=await request('/api/thread',{config:widget,order:'invalid'});assert.equal(r.status,400); });
  await check('named Repository RPC reads a validated GitHub thread', async () => { const data=await decode(await request('/api/thread',{config:widget}));assert.ok(data && typeof data==='object'); });
  await check('SQLite-backed RPC probe writes its first durable counter', async () => { assert.deepEqual(await decode(await request('/__test/probe')),{counter:1}); });

  const verifier=randomBytes(32).toString('base64url');
  const proof=createHash('sha256').update(verifier).digest('base64url');
  let attempt; let cookie; let ticket; let session;
  await check('first-party preparation creates cookie-bound OAuth state through RPC', async () => {
    const r=await request('/api/auth/prepare',{repo:'example/comments',origin:blog+'/article',challenge:proof,mode:'popup'});
    cookie=r.headers.get('set-cookie')?.split(';')[0];
    const data=await decode(r); attempt=data.attempt;
    const authorization = data.authorizeURL || data.authorizationURL;
    assert.ok(cookie && attempt && authorization,'Authorization preparation contract');
    const url=new URL(authorization);
    assert.equal(url.origin,'https://github.com'); assert.equal(url.pathname,'/login/oauth/authorize');
    const callback=new URL('/auth/callback',origin);
    callback.search=new URLSearchParams({state:url.searchParams.get('state'),code:'fixture_'+url.searchParams.get('code_challenge')}).toString();
    const result=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(result.status,200);
    const html=await result.text(); assert.ok(!html.includes('ghu_reader'));
  });
  await check('proof-authenticated polling and one-use handoff yield only an opaque session', async () => {
    const auth={repo:'example/comments',origin:blog+'/article',attempt,verifier};
    const data=await decode(await request('/api/auth/poll',auth)); ticket=data.ticket;
    assert.match(ticket,/^[A-Za-z0-9_-]{43}$/);
    const result=await decode(await request('/api/auth/consume',{...auth,ticket})); session=result.session;
    assert.match(session,/^[A-Za-z0-9_-]{43}$/);
    const replay=await request('/api/auth/consume',{...auth,ticket});assert.ok(replay.status>=400);
  });
  await stop(); await launch();
  await check('SQLite counter survives a workerd restart', async () => { assert.deepEqual(await decode(await request('/__test/probe')),{counter:2}); });
  await check('encrypted repository session survives that process restart', async () => {
    const data=await decode(await request('/api/thread',{config:widget},session)); assert.equal(data.viewer?.login,'reader');
  });
  await check('native rate limiting binding enforces its configured threshold', async () => {
    const key=randomBytes(16).toString('hex');let denied=false;
    for(let i=0;i<8;i++){const result=await decode(await request('/__test/native-limit?key='+key));if(!result.success){denied=true;break;}}
    assert.equal(denied,true);
  });
  report.status='passed';
} catch (error) {
  report.status = error?.code === 'ENOENT' ? 'not-run' : 'failed';
  report.details = error instanceof Error ? error.message : String(error);
  console.error(report.details);
  process.exitCode=1;
} finally {
  await stop();
  report.checks=tests;
  // Exclude Wrangler environment dumps from the report.
  await writeFile(resolve(evidence,'native-runtime.json'),JSON.stringify(report,null,2)+'\n');
  if(directory) await rm(directory,{recursive:true,force:true});
}
