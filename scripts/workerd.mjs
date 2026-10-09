import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** One native workerd instance, with durable storage retained across restarts. */
export async function workerd(entry, bindings, define = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'giscusflare-workerd-'));
  let runtime;
  try {
    const compile = async path => {
      const compiled = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], define });
      const options = convertV4MiniflareOptions({ name: 'verification', modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-09-25', ...bindings });
      options.resourcePersistencePath = directory;
      options.telemetry = { enabled: false };
      return options;
    };
    let options = await compile(entry);
    runtime = new Miniflare(options);
    return {
      versions: { miniflare: require('miniflare/package.json').version, workerd: require('workerd/package.json').version, compatibilityDate: options.workers[0].config.compatibilityDate },
      fetch: (url, init) => runtime.dispatchFetch(url, init),
      async restart(nextEntry) { await runtime.dispose(); if (nextEntry) options = await compile(nextEntry); runtime = new Miniflare(options); },
      async dispose() { try { await runtime.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
    };
  } catch (error) {
    try { await runtime?.dispose(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}
