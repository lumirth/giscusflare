import { readFile, readdir, stat } from 'node:fs/promises';
const packageJSON = JSON.parse(await readFile('package.json','utf8'));
if (!packageJSON.dependencies.hono || !packageJSON.dependencies.valibot) throw new Error('Add Hono and Valibot to package.json dependencies.');
const bundle = await readFile('dist/worker.mjs','utf8');
if (!bundle.includes('cloudflare:workers')) throw new Error('The Worker bundle is missing its cloudflare:workers import.');
for (const p of ['dist/browser/headless.js','dist/types/browser/headless.d.ts','dist/browser/native.js','dist/types/browser/native.d.ts','public/native.css','public/client.js','public/widget.js','public/auth-window.js','public/auth-complete.js','public/setup.js','public/widget.css','public/embed.css']) if (!(await stat(p)).size) throw new Error('Missing built asset: ' + p);
for (const name of await readdir('public')) if (/\.pem$|\.key$|^\.dev\.vars|^\.env/.test(name)) throw new Error('A secret file is in public assets. Remove it before packaging.');
if (!bundle.includes('Repository')) throw new Error('Repository export is missing.');
console.log('Release files are present.');
