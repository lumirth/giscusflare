import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'dist'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/browser/auth-window.ts'], outfile: 'dist/auth-window-demo.js',
  bundle: true, platform: 'browser', target: 'es2022', format: 'esm', minify: true,
  plugins: [{ name: 'local-authorization-only', setup(builder) {
    builder.onResolve({ filter: /^\.\/navigation\.js$/ }, args => {
      if (args.importer.endsWith('/auth-window.ts')) return { path: resolve(root, 'test/navigation-demo.ts') };
      return null;
    });
  } }]
});

for (const [entry, name] of [['examples/custom.ts', 'custom-example'], ['test/forum-browser.ts', 'forum-example']]) {
  await build({
    entryPoints: [entry], outdir: 'public', entryNames: name,
    chunkNames: 'chunks/example-[name]-[hash]', bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  });
}
