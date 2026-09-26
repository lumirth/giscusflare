import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
/** Select the binding format supported by the installed Wrangler schema. */
export async function rateBindings(values) {
  const path = fileURLToPath(new URL('../node_modules/wrangler/config-schema.json', import.meta.url));
  const text = await readFile(path, 'utf8');
  if (/"ratelimits"\s*:/.test(text)) return { ratelimits: values };
  if (text.includes('ratelimit')) return { unsafe: { bindings: values.map(item => ({ type: 'ratelimit', ...item })) } };
  throw new Error('This Wrangler version has no recognized rate-limiting configuration. Install the pinned version.');
}
