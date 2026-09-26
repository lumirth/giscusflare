import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await mkdir('dist', { recursive: true });
const worker = await build({ entryPoints: ['src/worker/entry.ts'], outfile: 'dist/worker.mjs', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'], minify: true, legalComments: 'eof', metafile: true });
await build({ entryPoints: ['src/testing.ts'], outfile: 'dist/testing.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node22', legalComments: 'eof' });
for (const name of ['client', 'widget', 'auth-window', 'auth-complete', 'setup']) {
  const result = await build({ entryPoints: [`src/browser/${name}.ts`], outfile: `public/${name}.js`, bundle: true, format: name === 'client' ? 'iife' : 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', metafile: true });
  const imports = Object.keys(result.metafile.inputs);
  if (imports.some(p => /node_modules\/(hono|valibot)/.test(p))) throw new Error(`${name}.js includes Hono or Valibot. Remove the server import.`);
}
await build({ entryPoints: ['src/browser/markdown.ts'], outfile: 'dist/markdown-browser.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
const sizes = {};
for (const name of ['dist/worker.mjs', 'public/client.js', 'public/widget.js', 'public/auth-window.js', 'public/auth-complete.js', 'public/setup.js', 'public/widget.css', 'public/embed.css']) {
  const buffer = await readFile(name); sizes[name] = { bytes: buffer.length, gzip: gzipSync(buffer).length, sha256: createHash('sha256').update(buffer).digest('hex') };
}
if (sizes['dist/worker.mjs'].gzip > 3 * 1024 * 1024) throw new Error('The Worker exceeds the 3 MiB gzip budget.');
await writeFile('dist/sizes.json', JSON.stringify(sizes, null, 2) + '\n');
await writeFile('dist/worker-metafile.json', JSON.stringify(worker.metafile, null, 2) + '\n');
console.log(JSON.stringify({ build: 'passed', sizes }, null, 2));
