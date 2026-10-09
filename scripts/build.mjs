import { build } from 'esbuild';
import { buildStyles } from './build-styles.mjs';
import { buildAssets, browserGraph } from './build-assets.mjs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
for (const path of ['public/chunks', 'dist/browser', 'dist/types']) await rm(path, { recursive: true, force: true });
for (const name of await readdir('public')) if (name.endsWith('.js')) await rm('public/' + name);
await mkdir('dist', { recursive: true });
await buildStyles();
const common = { bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof', metafile: true };
const worker = await build({ ...common, entryPoints: ['src/worker/entry.ts'], outfile: 'dist/worker.mjs', platform: 'neutral', external: ['cloudflare:workers'] });
for (const [entry, output] of [['worker', 'content-worker'], ['stock', 'stock-content-worker']]) {
  const compiled = await build({ ...common, entryPoints: ['src/content/' + entry + '.ts'], outfile: 'dist/' + output + '.mjs', platform: 'neutral', external: ['cloudflare:workers'] });
  await writeFile('dist/' + output + '-metafile.json', JSON.stringify(compiled.metafile, null, 2) + '\n');
}
const registration = await build({ ...common, entryPoints: ['src/registration.ts'], outfile: 'dist/registration.mjs', platform: 'neutral' });
await writeFile('dist/registration-metafile.json', JSON.stringify(registration.metafile, null, 2) + '\n');
await build({ ...common, entryPoints: ['src/browser/client.ts'], outfile: 'public/client.js', format: 'iife', platform: 'browser' });
// Package imports and hosted modules use this one graph, with identical chunk identities.
const entries = ['widget', 'native', 'headless', 'mona', 'counts', 'interactions', 'content', 'github-content', 'stock-content', 'auth-window', 'auth-complete', 'setup'];
const browser = await build({ ...common, entryPoints: {
  ...Object.fromEntries(entries.map(name => [name, 'src/browser/' + name + '.ts'])), model: 'src/conversation/index.ts',
}, outdir: 'dist/browser', chunkNames: 'chunks/[name]-[hash]', splitting: true, platform: 'browser' });
await cp('dist/browser', 'public', { recursive: true });
await writeFile('dist/browser-metafile.json', JSON.stringify(browser.metafile, null, 2) + '\n');
await writeFile('dist/worker-metafile.json', JSON.stringify(worker.metafile, null, 2) + '\n');
const outputs = browser.metafile.outputs;
const sizes = {};
for (const name of ['dist/worker.mjs', 'dist/registration.mjs', 'dist/content-worker.mjs', 'dist/stock-content-worker.mjs', 'public/client.js', 'public/widget.js', 'public/auth-window.js', 'public/auth-complete.js', 'public/setup.js', 'public/widget.css', 'public/embed.css']) {
  const data = await readFile(name);
  sizes[name] = { bytes: data.length, gzip: gzipSync(data).length, sha256: createHash('sha256').update(data).digest('hex') };
}
sizes.browserGraphs = {};
const summarize = async files => {
  let bytes = 0, gzip = 0;
  for (const name of files) { const data = await readFile(name); bytes += data.length; gzip += gzipSync(data).length; }
  return { files: [...files], bytes, gzip };
};
for (const entry of entries) {
  const path = 'dist/browser/' + entry + '.js';
  sizes.browserGraphs[entry] = { initial: await summarize(browserGraph(outputs, path, false)), includingLazy: await summarize(browserGraph(outputs, path)) };
}
await writeFile('dist/sizes.json', JSON.stringify(sizes, null, 2) + '\n');
await buildAssets(outputs);
console.log(JSON.stringify({ build: 'passed', sizes }, null, 2));
