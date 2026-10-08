import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadModule(entryPoints, options = {}) {
  const directory = await mkdtemp(resolve('dist/test-module-'));
  const outfile = join(directory, 'entry.mjs');
  try {
    await build({ ...(entryPoints ? { entryPoints: [entryPoints] } : {}), outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', ...options });
    return await import(pathToFileURL(outfile).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
