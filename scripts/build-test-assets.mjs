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
await build({
  absWorkingDir: root, stdin: { contents: "export * from './src/browser/markdown.ts';", resolveDir: root, sourcefile: 'browser-test-entry.ts' },
  outfile: 'dist/renderer-test.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'GiscusRendererTest', minify: false
});
await build({
  absWorkingDir: root, entryPoints: ['src/browser/widget.ts'], outfile: 'dist/widget-test.js',
  bundle: true, platform: 'browser', target: 'es2022', format: 'iife', minify: false
});
