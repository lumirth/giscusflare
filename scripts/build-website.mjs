import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const origin = new URL(process.env.GISCUSFLARE_DEMO_ORIGIN || '');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('GISCUSFLARE_DEMO_ORIGIN must be an HTTPS service origin.');
const number = Number(process.env.GISCUSFLARE_DEMO_NUMBER);
if (!Number.isSafeInteger(number) || number < 1) throw new Error('GISCUSFLARE_DEMO_NUMBER must identify the public demo discussion.');
await rm('dist/website', { recursive: true, force: true });
await mkdir('dist/website', { recursive: true });
for (const name of ['index.html', 'style.css', 'forum.css', 'assets']) await cp('website/' + name, 'dist/website/' + name, { recursive: true });
await cp('dist/assets/native.css', 'dist/website/native.css');
// Changed styles get new URLs so an HTML update cannot reuse stale page CSS.
let html = await readFile('dist/website/index.html', 'utf8');
for (const name of ['style.css', 'native.css', 'forum.css']) {
  const digest = createHash('sha256').update(await readFile('dist/website/' + name)).digest('hex').slice(0, 12);
  const versioned = name.replace('.css', '-' + digest + '.css');
  await rename('dist/website/' + name, 'dist/website/' + versioned);
  html = html.replace('href="' + name + '"', 'href="' + versioned + '"');
}
await writeFile('dist/website/index.html', html);
await build({ entryPoints: ['website/demo.ts'], outdir: 'dist/website', bundle: true, format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]', minify: true, platform: 'browser', target: 'es2022', define: { DEMO_ORIGIN: JSON.stringify(origin.origin), DEMO_NUMBER: String(number) } });
if (process.env.GISCUSFLARE_WEBSITE_DOMAIN) {
  const domain = process.env.GISCUSFLARE_WEBSITE_DOMAIN;
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.includes('..')) throw new Error('Invalid GISCUSFLARE_WEBSITE_DOMAIN.');
  await writeFile('dist/website/CNAME', domain + '\n');
}
