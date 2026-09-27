import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../dist/assets/', import.meta.url);
export const assetManifest = JSON.parse(await readFile(new URL('../dist/asset-manifest.json', import.meta.url), 'utf8'));

/** Copy only the runtime assets needed by this deployment. Existing unrelated files are preserved. */
export async function copyAssets(destination, groups = ['auth', 'setup', 'iframe']) {
  const selected = new Set();
  for (const group of groups) {
    const files = assetManifest.groups[group];
    if (!files) throw new Error('Unknown giscusflare asset group: ' + group);
    for (const name of files) selected.add(name);
  }
  const directory = destination instanceof URL ? fileURLToPath(destination) : resolve(destination);
  for (const name of selected) {
    await mkdir(dirname(resolve(directory, name)), { recursive: true });
    await cp(new URL(name, root), resolve(directory, name));
  }
  return [...selected].sort();
}
