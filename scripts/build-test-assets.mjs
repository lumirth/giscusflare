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

await build({ entryPoints: ['src/testing.ts'], outfile: 'dist/testing.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node22', legalComments: 'eof' });
await build({ entryPoints: ['src/browser/markdown.ts'], outfile: 'dist/markdown-browser.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
const example = await build({entryPoints:['examples/custom.ts'],outdir:'public',entryNames:'custom-example',chunkNames:'chunks/example-[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,metafile:true});
if(Object.keys(example.metafile.inputs).some(name=>name.endsWith('/widget.ts')||name.endsWith('/native.ts')||name.includes('/standard/')))throw new Error('Custom consumer imports the default presentation.');
