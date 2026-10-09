import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { workerd } from '../scripts/workerd.mjs';
import { githubServer } from './github-server.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
export const publicAssets = (demo = false) => async (request) => {
    const directory = resolve(root, 'public');
    let path;
    try {
        path = decodeURIComponent(new URL(request.url).pathname);
    }
    catch {
        return new Response('Bad path', { status: 400 });
    }
    const file = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(directory + sep))
        return new Response('Not found', { status: 404 });
    try {
        const bytes = await readFile(demo && path === '/auth-window.js' ? resolve(root, 'dist/auth-window-demo.js') : file);
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    }
    catch {
        return new Response('Not found', { status: 404 });
    }
};
export const providerTransport = origin => async (request) => {
    if (!['https://api.github.com', 'https://github.com'].includes(new URL(request.url).origin))
        throw new Error('Unexpected fixture egress: ' + request.url);
    const headers = new Headers(request.headers);
    headers.set('X-Fixture-GitHub-URL', request.url);
    return fetch(origin, { method: request.method, headers, redirect: 'manual', ...(request.body ? { body: await request.arrayBuffer() } : {}) });
};
/** The real Worker and SQLite repository, with one independent simulated provider. */
export async function nativeService({ origin, blog, seed = true, assets = publicAssets(), repositories, openHosting, entry = 'src/worker/entry.ts', contentEntry = 'dist/stock-content-worker.mjs' }) {
    const github = await githubServer({ seed });
    let runtime;
    try {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        runtime = await workerd(entry, {
            serviceBindings: { ASSETS: assets, CONTENT: { name: 'content' } },
            outboundService: providerTransport(github.origin),
            durableObjects: { REPOSITORY_STORE: { className: 'Repository', useSQLite: true } },
            ratelimits: Object.fromEntries([['READ_LIMITER', 120], ['WRITE_LIMITER', 30], ['AUTH_LIMITER', 6]].map(([name, limit], i) => [name, { namespace_id: String(84101 + i), simple: { limit, period: 60 } }])),
            bindings: {
                PUBLIC_ORIGIN: origin, GITHUB_APP_ID: '12345', GITHUB_CLIENT_ID: 'Iv1.fixture',
                GITHUB_CLIENT_SECRET: 'fixture-client-secret', GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
                SESSION_SECRET: randomBytes(32).toString('base64url'),
                ...(openHosting ? {OPEN_HOSTING:openHosting} : {}),
                REPOSITORIES: repositories || { 'example/comments': { repositoryId: 'R_fixture', installationId: 123, categoryId: 'CAT_fixture', origins: [blog], category: 'Announcements', defaultCommentOrder: 'oldest', customThemeOrigins: ['https://themes.example'] } },
            },
        }, {}, [{ name: 'content', entry: contentEntry }]);
        return { github: github.upstream, versions: runtime.versions, fetch: runtime.fetch,
            restart: entry => runtime.restart(entry),
            async dispose() { try {
                await runtime.dispose();
            }
            finally {
                await github.dispose();
            } },
        };
    }
    catch (error) {
        await github.dispose();
        throw error;
    }
}
