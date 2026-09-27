/** Local server with simulated GitHub responses. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../dist/testing.mjs';
import * as fixtures from '../test/fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(root, 'public');
const port = Number(process.env.PORT || 8787);
const blogPort = Number(process.env.BLOG_PORT || 8788);
for (const p of [port, blogPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('Use a port between 1024 and 65535.');
if (port === blogPort) throw new Error('The Worker and blog need different ports.');
const origin = `http://127.0.0.1:${port}`;
const blog = `http://127.0.0.1:${blogPort}`;
const createFixture = fixtures.fixture || fixtures.createFixture;
if (typeof createFixture !== 'function') throw new Error('The demo fixture is missing. Run npm test.');
const fixture = await createFixture({seed:true});
if (!fixture.env) throw new Error('The demo fixture has no environment.');
const env = fixture.env;
env.PUBLIC_ORIGIN = origin;
env.REPOSITORIES = {
  'example/comments': {
    origins: [blog], category: 'Announcements', defaultCommentOrder: 'oldest', customThemeOrigins: []
  }
};
const mime = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
let assets;
assets = {
  async fetch(request) {
    let path;
    try { path = decodeURIComponent(new URL(request.url).pathname); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (path === '/') path = '/index.html';
    let filename = resolve(publicRoot, '.' + path);
    if (!filename.startsWith(publicRoot + sep)) return new Response('Not found', { status: 404 });
    // The demo redirects sign-in to its local GitHub simulator.
    if (path === '/auth-window.js') filename = resolve(root, 'dist/auth-window-demo.js');
    try {
      if (!(await stat(filename)).isFile()) return new Response('Not found', { status: 404 });
      const bytes = await readFile(filename);
      return new Response(request.method === 'HEAD' ? null : bytes, {
        headers: {
          'Content-Type': mime[extname(filename)] || 'application/octet-stream',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*', 'Referrer-Policy': 'no-referrer'
        }
      });
    } catch { return new Response('Not found', { status: 404 }); }
  }
};
env.ASSETS = assets;
const localContext = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parentHTML(url) {
  if(url.pathname==='/native')return nativeHTML(url);
  const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'preferred_color_scheme';
  const width=Number(url.searchParams.get('width'));
  const frameWidth=Number.isFinite(width)&&width>=320&&width<=1200?width:0;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comment demo</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#242b35;font:16px/1.7 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:44px 22px}h1{font-size:clamp(32px,6vw,48px);line-height:1.15;letter-spacing:-.05em}.note{border-left:3px solid #8895a7;padding:12px 18px;background:#eaf0f5}main > .giscus{${frameWidth?`width:${frameWidth+42}px;max-width:100%;`:``}margin-top:32px;padding:20px;background:${theme==='dark'?'#0d1117':'white'};border:1px solid #dce2e8;border-radius:8px}@media(max-width:480px){main{padding:24px 12px}.giscus{padding:12px}}</style></head><body><main><h1>Comment demo</h1><p class="note">Comments and GitHub sign-in are simulated. Nothing is posted online.</p><div class="giscus"></div><script src="${escape(origin)}/client.js" data-repo="example/comments" data-category="Announcements" data-mapping="specific" data-term="article" data-theme="${theme}" data-input-position="bottom" data-emit-metadata="1" async></script></main></body></html>`;
}
async function bridge(req, res, run) {
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 100000) { res.writeHead(413); res.end('Too large'); return; } chunks.push(chunk); }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method, headers: req.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {})
    });
    const response = await run(request);
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie?.(); if (cookies?.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (error) {
    console.error('Demo error:', error instanceof Error ? error.message : 'unknown error');
    if (!res.headersSent) res.writeHead(500);
    res.end('Demo failed. See the terminal for details.');
  }
}
const requestCounts = new Map();
const server = createServer((req, res) => bridge(req, res, async request => {
  const url = new URL(request.url);
  fixture.advance?.(Math.max(0, Date.now() - fixture.clock()));
  if (url.pathname === '/__demo/requests') return Response.json(Object.fromEntries(requestCounts));
  requestCounts.set(url.pathname, (requestCounts.get(url.pathname) || 0) + 1);
  if (url.pathname === '/__demo/authorize') {
    const state = url.searchParams.get('state'); const challenge = url.searchParams.get('code_challenge');
    if (!state || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return new Response('Invalid demo sign-in request', { status: 400 });
    return Response.redirect(origin + '/auth/callback?' + new URLSearchParams({ state, code: 'fixture_' + challenge }), 302);
  }
  return app.fetch(request, env, localContext);
}));
const parent = createServer((req, res) => bridge(req, res, async request => {
  const url = new URL(request.url);
  if (process.env.PUBLIC_DEMO_DIRECTORY && url.pathname.startsWith('/public-demo/')) {
    const directory = resolve(process.env.PUBLIC_DEMO_DIRECTORY);
    const filename = resolve(directory, '.' + (url.pathname.slice('/public-demo'.length) || '/index.html').replace(/^\/$/, '/index.html'));
    if (!filename.startsWith(directory + sep)) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(filename), { headers: { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  }
  return new Response(parentHTML(url), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}));
function listen(server, p) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '127.0.0.1', resolve); }); }
await Promise.all([listen(server, port), listen(parent, blogPort)]);
console.log(`Local demo\nBlog: ${blog}/article\nSetup: ${origin}/`);
let closed = false;
function close() { if (closed) return; closed = true; server.close(); parent.close(); fixture.close?.(); }
process.once('SIGINT', () => { close(); process.exit(130); });
process.once('SIGTERM', () => { close(); process.exit(0); });

function nativeHTML(url){
 const config={repo:'example/comments',repoId:'',category:'Announcements',categoryId:'',origin:blog+'/native',backLink:blog+'/native',term:'article',number:0,strict:false,theme:url.searchParams.get('theme')==='dark'?'dark':'light',lang:'en',reactionsEnabled:true,emitMetadata:true,inputPosition:'bottom',description:''};
 const {theme,lang,inputPosition,reactionsEnabled,emitMetadata,...page}=config;
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>giscusflare native demo</title><link rel="stylesheet" href="${origin}/native.css"><style>body{font:16px/1.6 system-ui;max-width:760px;margin:3rem auto;padding:0 1rem}#comments{padding:1rem}</style></head><body><h1>giscusflare · native page</h1><p>Local fixture: GitHub and sign-in are simulated. Nothing is posted online.</p><button id="refresh">Refresh</button><button id="theme">Toggle theme</button><div id="comments"></div><script type="module">import {mountComments} from '${origin}/native.js';window.demoComments=mountComments(document.getElementById('comments'),{service:'${origin}',page:${JSON.stringify(page)},appearance:${JSON.stringify({theme,lang,inputPosition,reactionsEnabled,emitMetadata})}});document.getElementById('refresh').onmousedown=event=>event.preventDefault();document.getElementById('refresh').onclick=()=>window.demoComments.refresh();document.getElementById('theme').onclick=()=>window.demoComments.updateAppearance({theme:window.demoComments.appearance.theme==='dark'?'light':'dark'});</script></body></html>`;
}
