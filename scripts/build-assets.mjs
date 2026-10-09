import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** The emitted graph determines both resource measurements and deployment closures. */
export function browserGraph(outputs, entry, dynamic = true, seen = new Set()) {
  if (seen.has(entry)) return seen;
  const output = outputs[entry];
  if (!output) throw new Error('Missing browser output: ' + entry);
  seen.add(entry);
  for (const dependency of output.imports) {
    if (!dependency.external && (dynamic || dependency.kind !== 'dynamic-import')) browserGraph(outputs, dependency.path, dynamic, seen);
  }
  return seen;
}
export async function buildAssets(outputs) {
  const script = entry => [...browserGraph(outputs, 'dist/browser/' + entry)].map(path => path.slice('dist/browser/'.length));
  const themes = (await readdir('public/themes')).filter(name => name.endsWith('.css')).map(name => 'themes/' + name);
  const groups = {
    auth: [...script('auth-window.js'), ...script('auth-complete.js'), 'auth.css', '_headers'],
    setup: [...script('setup.js'), 'index.html', 'setup.css', 'brand/favicon.png', 'brand/giscusflare-logo.png'],
    iframe: [...script('widget.js'), 'client.js', 'widget.css', 'content.css', 'iframe.css', 'embed.css', ...themes],
    native: [...script('native.js'), 'native.css', 'content.css'],
    headless: script('headless.js'),
    counts: script('counts.js'),
    mona: [...script('mona.js'), 'mona.css'],
    content: [...script('content.js'), ...script('github-content.js'), ...script('stock-content.js'), 'content.css'],
  };
  // Stable entry URLs revalidate; their content-addressed imports stay immutable.
  const entries = ['client.js', ...Object.keys(outputs).filter(path => /^dist\/browser\/[^/]+\.js$/.test(path)).map(path => path.slice('dist/browser/'.length))].sort();
  const headers = await readFile('package/_headers', 'utf8');
  await writeFile('public/_headers', headers + entries.map(name => '\n/' + name + '\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache\n').join(''));
  await rm('dist/assets', { recursive: true, force: true });
  const files = {};
  for (const name of new Set(Object.values(groups).flat())) {
    if (name.startsWith('/') || name.includes('..')) throw new Error('Invalid asset path: ' + name);
    await mkdir(dirname('dist/assets/' + name), { recursive: true });
    await cp('public/' + name, 'dist/assets/' + name);
    const data = await readFile('dist/assets/' + name);
    files[name] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  const manifest = { version: 1, groups: Object.fromEntries(Object.entries(groups).map(([name, files]) => [name, [...new Set(files)].sort()])), files };
  await writeFile('dist/asset-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
