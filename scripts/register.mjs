import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { registerRepository } from '../dist/registration.mjs';

let args;
try { args = parseArgs({ options: Object.fromEntries(['config', 'secrets', 'repo', 'category'].map(name => [name, { type: 'string' }])) }).values; }
catch { throw new Error('Use --config FILE --secrets FILE --repo owner/name [--category NAME].'); }
if (Object.values(args).some(value => !value)) throw new Error('Use --config FILE --secrets FILE --repo owner/name [--category NAME].');
const filename = args.config || 'wrangler.jsonc';
const config = JSON.parse(await readFile(filename, 'utf8'));
const repo = args.repo, category = args.category || config.vars?.REPOSITORIES?.[repo]?.category;
if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo || '') || !category) throw new Error('Supply the canonical repository name and its category.');
const local = args.secrets ? parseEnv(await readFile(args.secrets, 'utf8')) : {};
const privateKey = local.GITHUB_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY;
if (!privateKey) throw new Error('Supply the existing App private key through --secrets or GITHUB_PRIVATE_KEY.');
const result = await registerRepository(repo, category, { appId: config.vars?.GITHUB_APP_ID }, { privateKey });
// Only public registration facts leave the operator process. Credentials never do.
console.log(JSON.stringify({ repo, category, ...result }, null, 2));
