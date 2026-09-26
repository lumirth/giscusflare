import { readFile } from 'node:fs/promises';
import { configSchemas } from '../dist/testing.mjs';
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const parsed = configSchemas.configuration(config.vars);
if (!parsed.origin.startsWith('https://') || parsed.origin.endsWith('.example.com') || parsed.clientId.includes('REPLACE') || Object.keys(parsed.repositories).some(r => r.startsWith('your-account/'))) throw new Error('Set your HTTPS service origin, GitHub App IDs, and public repository in wrangler.jsonc.');
if (!config.durable_objects?.bindings?.some(x => x.name === 'REPOSITORY_STORE') || !config.migrations?.some(x => x.new_sqlite_classes?.includes('Repository'))) throw new Error('Add the REPOSITORY_STORE binding and Repository SQLite migration.');
const limits = config.ratelimits || config.unsafe?.bindings?.filter(b => b.type === 'ratelimit') || [];
for (const name of ['READ_LIMITER','WRITE_LIMITER','AUTH_LIMITER']) if (!limits.some(x => x.name === name)) throw new Error('Missing native rate limiter: ' + name);
console.log('Public configuration is valid.');
