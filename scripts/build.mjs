import { build } from 'esbuild';
import { buildStyles } from './build-styles.mjs';
import { buildAssets } from './build-assets.mjs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
for (const path of ['public/chunks', 'dist/browser', 'dist/types']) await rm(path, { recursive: true, force: true });
for (const name of await readdir('public')) if (name.endsWith('.js')) await rm('public/' + name);
await mkdir('dist', { recursive: true });
await buildStyles();
const common = { bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof', metafile: true };
await build({ ...common, entryPoints: ['src/worker/entry.ts'], outfile: 'dist/worker.mjs', platform: 'neutral', external: ['cloudflare:workers'] });
for (const [entry, output] of [['worker', 'content-worker'], ['stock', 'stock-content-worker']]) {
  await build({ ...common, entryPoints: ['src/content/' + entry + '.ts'], outfile: 'dist/' + output + '.mjs', platform: 'neutral', external: ['cloudflare:workers'] });
}
await build({ ...common, entryPoints: ['src/registration.ts'], outfile: 'dist/registration.mjs', platform: 'neutral' });
await build({ ...common, entryPoints: ['src/browser/client.ts'], outfile: 'public/client.js', format: 'iife', platform: 'browser' });
// Package imports and hosted modules use this one graph, with identical chunk identities.
const entries = ['widget', 'native', 'headless', 'mona', 'counts', 'interactions', 'content', 'github-content', 'stock-content', 'auth-window', 'auth-complete', 'setup'];
const browser = await build({ ...common, entryPoints: {
  ...Object.fromEntries(entries.map(name => [name, 'src/browser/' + name + '.ts'])), model: 'src/conversation/index.ts',
}, outdir: 'dist/browser', chunkNames: 'chunks/[name]-[hash]', splitting: true, platform: 'browser' });
await cp('dist/browser', 'public', { recursive: true });
await buildAssets(browser.metafile.outputs);
