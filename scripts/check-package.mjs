import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
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
  for (const [path, metadata] of Object.entries(assetManifest.files)) {
    const data = await readFile(join(directory, 'dist/assets', path));
    assert.equal(data.length, metadata.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), metadata.sha256);
    // Hosted and imported modules are copies of the same compiled graph.
    if (path.endsWith('.js') && path !== 'client.js') assert.deepEqual(data, await readFile(join(directory, 'dist/browser', path)));
  }
  const headerRules = (await readFile(join(directory, 'dist/assets/_headers'), 'utf8')).trim().split(/\n\s*\n/).map(block => block.split('\n'));
  for (const path of Object.keys(assetManifest.files).filter(path => /\.(?:js|css)$/.test(path))) {
    const policies = headerRules.filter(([pattern]) => new RegExp('^' + pattern.replaceAll('.', '\\.').replaceAll('*', '.*') + '$').test('/' + path)).flatMap(rule => rule.filter(line => line.trim().startsWith('Cache-Control:')));
    assert.deepEqual(policies.map(line => line.trim()), ['Cache-Control: ' + (path.startsWith('chunks/') ? 'public, max-age=31536000, immutable' : 'no-cache')], 'Overlapping or stale asset policy: ' + path);
  }
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
  await writeFile(join(temporary, 'custom.ts'), `import { createConversation, mountPresentation } from 'giscusflare/headless';\nimport { createEditor } from 'giscusflare/interactions';\nimport { mountContent } from 'giscusflare/content';\nimport { createCounts } from 'giscusflare/counts';\nexport { createConversation, mountPresentation, createEditor, mountContent, createCounts };\n`);
  await writeFile(join(temporary, 'native.ts'), `import { mountComments } from 'giscusflare';\nimport { stockContent } from 'giscusflare/content/stock';\nexport { mountComments, stockContent };\n`);
  await writeFile(join(temporary, 'github.ts'), `export { githubContent } from 'giscusflare/content/github';\n`);
  await writeFile(join(temporary, 'mona.ts'), `export { mona } from 'giscusflare/mona';\n`);
  await writeFile(join(temporary, 'model.ts'), `import { PageModel, type Transport } from 'giscusflare/model';\nexport function acquire(transport: Transport) { return new PageModel({ repo: 'example/comments', selector: { kind: 'page', key: 'article' }, origin: 'https://example.test', pageURL: 'https://example.test/article', returnURL: 'https://example.test/article' }, transport); }\n`);
  await writeFile(join(temporary, 'worker.ts'), `export { default, Repository } from 'giscusflare/worker';
import { createContentWorker, type ContentPreparer } from 'giscusflare/content/worker';
const prepare: ContentPreparer = input => ({ html: '<p>' + input.markdown.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</p>' });
export const content = createContentWorker({ revision: 'consumer-1', prepare });
export { default as stockContent } from 'giscusflare/content/worker/stock';
export { registerRepository } from 'giscusflare/registration';\n`);
  await cp('examples', join(temporary, 'examples'), { recursive: true });
  await writeFile(join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: false, types: [], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['custom.ts', 'native.ts', 'github.ts', 'model.ts', 'mona.ts', 'worker.ts', 'examples/**/*.ts'] }));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(temporary, 'tsconfig.json')], { stdio: 'inherit' });
  await mkdir(join(temporary, 'node_modules/@types'), { recursive: true });
  await symlink(resolve('node_modules/@types/node'), join(temporary, 'node_modules/@types/node'), 'dir');
  await symlink(resolve('node_modules/undici-types'), join(temporary, 'node_modules/undici-types'), 'dir');
  await writeFile(join(temporary, 'tsconfig.model.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: false, types: ['node'], lib: ['ES2022'] }, include: ['model.ts', 'mona.ts'] }));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(temporary, 'tsconfig.model.json')], { stdio: 'inherit' });
  const browserResources = {};
  for (const entry of ['custom', 'native', 'github']) {
    const compiled = await build({ absWorkingDir: temporary, entryPoints: [entry + '.ts'], bundle: true, minify: true, write: false, platform: 'browser', format: 'esm' });
    browserResources[entry] = { bytes: compiled.outputFiles.reduce((size, file) => size + file.contents.length, 0), gzip: compiled.outputFiles.reduce((size, file) => size + gzipSync(file.contents).length, 0) };
  }
  const monaFile = join(temporary, 'mona.mjs');
  await build({ absWorkingDir: temporary, entryPoints: ['mona.ts'], bundle: true, outfile: monaFile, platform: 'node', format: 'esm' });
  const { mona } = await import(pathToFileURL(monaFile).href);
  assert(mona.startsWith('<svg') && !mona.includes('<image'));
  assert.equal((await copyAssets(join(temporary, 'mona-assets'), ['mona'])).includes('mona.css'), true);
  const modelFile = join(temporary, 'model.mjs');
  await build({ absWorkingDir: temporary, entryPoints: ['model.ts'], bundle: true, outfile: modelFile, platform: 'node', format: 'esm' });
  await import(pathToFileURL(modelFile).href);
  await build({ absWorkingDir: temporary, entryPoints: ['worker.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', external: ['cloudflare:workers'] });
  console.log(JSON.stringify({ package: packed.filename, packedFiles: paths.length, browserResources, selectedAssets: selected.length, standardAssets: standard.length, isolatedCustomBrowser: true, isolatedNativeBrowser: true, isolatedGitHubBrowser: true, isolatedPortableModel: true, isolatedSSRMarkup: true, modelTypesWithoutDOM: true, isolatedTypedWorker: true, examplesOrTestsShipped: false }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
