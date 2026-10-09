import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { registerRepository } from '../dist/registration.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--config', '--secrets', '--repo', '--category'].includes(key) || !value) throw new Error('Use --config FILE --secrets FILE --repo owner/name [--category NAME].');
  args.set(key, value);
}
const filename = args.get('--config') || 'wrangler.jsonc';
const config = JSON.parse(await readFile(filename, 'utf8'));
const repo = args.get('--repo'), category = args.get('--category') || config.vars?.REPOSITORIES?.[repo]?.category;
if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo || '') || !category) throw new Error('Supply the canonical repository name and its category.');
const local = args.has('--secrets') ? parseEnv(await readFile(args.get('--secrets'), 'utf8')) : {};
const privateKey = local.GITHUB_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY;
if (!privateKey) throw new Error('Supply the existing App private key through --secrets or GITHUB_PRIVATE_KEY.');
const result = await registerRepository(repo, category, { appId: config.vars?.GITHUB_APP_ID }, { privateKey });
// Only public registration facts leave the operator process. Credentials never do.
console.log(JSON.stringify({ repo, category, ...result }, null, 2));
