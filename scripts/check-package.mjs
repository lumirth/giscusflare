import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'giscusflare-package-'));
try {
  const packResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { encoding: 'utf8' }));
  const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
  const paths = packed.files.map(file => file.path);
  for (const path of paths) assert(!/(^|\/)(?:test|testing|examples|evidence)(\/|\.)|custom-example|auth-window-demo|\.pem$|\.dev\.vars|\.env/.test(path), 'Development or secret artifact shipped: ' + path);
  const directory = join(temporary, 'node_modules/giscusflare');
  await mkdir(directory, { recursive: true });
  execFileSync('tar', ['-xzf', join(temporary, packed.filename), '--strip-components=1', '-C', directory]);
  for (const dependency of Object.keys(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies)) {
    const destination = join(temporary, 'node_modules', dependency);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(resolve('node_modules', dependency), destination, 'dir');
  }
  const { copyAssets, assetManifest } = await import(pathToFileURL(join(directory, 'package/assets.mjs')).href);
  for (const [path, metadata] of Object.entries(assetManifest.files)) assert.equal((await readFile(join(directory, 'dist/assets', path))).length, metadata.bytes);
  const selected = await copyAssets(join(temporary, 'custom-assets'), ['auth', 'setup']);
  assert(!selected.includes('widget.js'));
  assert(!selected.includes('widget.css'));
  assert(!selected.includes('native.css'));
  assert(selected.includes('index.html'));
  assert(selected.includes('auth-window.js'));
  await assert.rejects(copyAssets(join(temporary, 'bad'), ['unknown']));
  const standard = await copyAssets(join(temporary, 'standard-assets'));
  assert(standard.includes('widget.js'));
  assert(standard.includes('themes/dark.css'));
  await writeFile(join(temporary, 'custom.ts'), `import { createConversation, mountPresentation } from 'giscusflare/headless';\nimport { createEditor } from 'giscusflare/interactions';\nimport { mountContent } from 'giscusflare/content';\nexport { createConversation, mountPresentation, createEditor, mountContent };\n`);
  await cp('examples', join(temporary, 'examples'), { recursive: true });
  await writeFile(join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true, types: [], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['custom.ts', 'examples/**/*.ts'] }));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(temporary, 'tsconfig.json')], { stdio: 'inherit' });
  await build({ absWorkingDir: temporary, entryPoints: ['custom.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
  await writeFile(join(temporary, 'worker.ts'), "export { default, Repository } from 'giscusflare/worker';\n");
  await build({ absWorkingDir: temporary, entryPoints: ['worker.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', external: ['cloudflare:workers'] });
  console.log(JSON.stringify({ package: packed.filename, packedFiles: paths.length, selectedAssets: selected.length, standardAssets: standard.length, isolatedCustomBrowser: true, isolatedWorker: true, examplesOrTestsShipped: false }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
