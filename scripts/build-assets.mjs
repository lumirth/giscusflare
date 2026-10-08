import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const { outputs } = JSON.parse(await readFile('dist/browser-metafile.json', 'utf8'));
const graph = (entry, seen = new Set()) => {
  if (seen.has(entry.slice('public/'.length))) return seen;
  const output = outputs[entry];
  if (!output) throw new Error('Missing browser output: ' + entry);
  seen.add(entry.slice('public/'.length));
  for (const dependency of output.imports) {
    if (!dependency.external && !seen.has(dependency.path.slice('public/'.length))) graph(dependency.path, seen);
  }
  return seen;
};
const script = entry => [...graph('public/' + entry)];
const themes = (await readdir('public/themes')).filter(name => name.endsWith('.css')).map(name => 'themes/' + name);
const groups = {
  auth: [...script('auth-window.js'), ...script('auth-complete.js'), 'auth.css', '_headers'],
  setup: [...script('setup.js'), 'index.html', 'setup.css', 'brand/favicon.png', 'brand/giscusflare-logo.png'],
  iframe: [...script('widget.js'), 'client.js', 'widget.css', 'iframe.css', 'embed.css', ...themes],
  native: [...script('native.js'), 'native.css'],
  headless: script('headless.js'),
};
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
