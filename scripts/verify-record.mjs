/** Write a verification report from recorded command exits. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'docs/evidence');
await mkdir(directory, { recursive: true });
async function readOptional(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}
const commands = [
  ['dependency installation', 'npm-install'], ['strict type check', 'typecheck-latest'],
  ['application build', 'build-complete'], ['Node/build suite', 'all-tests'],
  ['native runtime', 'native-runtime'], ['browser component mode', 'browser-component'],
];
const checks = [];
for (const [name, base] of commands) {
  const text = await readOptional(resolve(directory, base + '.exit'));
  const log = await readOptional(resolve(directory, base + '.log'));
  const exit = text !== null && /^\d+\s*$/.test(text) ? Number(text) : null;
  checks.push({
    name, status: exit === null ? 'not-recorded' : exit === 0 ? 'command-passed' : 'command-failed',
    exitCode: exit, log: log === null ? null : 'docs/evidence/' + base + '.log',
  });
}
for (const file of ['native-runtime.json', 'browser.json']) {
  const value = await readOptional(resolve(directory, file));
  if (value) {
    try { checks.push({ name: file, report: JSON.parse(value) }); }
    catch { checks.push({ name: file, status: 'invalid-report' }); }
  }
}
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packages = {};
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  const requested = manifest.dependencies?.[name] || manifest.devDependencies?.[name];
  try {
    const installed = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    packages[name] = { requested, installed };
  } catch { packages[name] = { requested, installed: null }; }
}
const summary = {
  release: manifest.version, recordedAt: new Date().toISOString(), node: process.version,
  checks, packages, liveGitHub: 'not-performed', cloudflareDeployment: 'not-performed',
  productionFreeTierCPU: 'not-measured', remoteCI: 'not-run-here',
};
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const labels = { 'command-passed': 'Passed', 'command-failed': 'Failed', 'not-recorded': 'No result recorded', 'invalid-report': 'Invalid report' };
const rows = checks.filter(check => check.status).map(check =>
  `| ${check.name} | ${labels[check.status] || check.status} | ${check.exitCode == null ? 'Not recorded' : `Exit ${check.exitCode}`} |`
).join('\n');
await writeFile(resolve(root, 'VERIFICATION.md'), `# Verification\n\nRecorded ${summary.recordedAt}.\n\n| Check | Result | Exit |\n| --- | --- | --- |\n${rows}\n\nThe [command record](docs/evidence/summary.json) links to each log and lists installed package versions. A zero exit code records success for that command. Missing results are not counted as passes.\n\nGitHub is simulated in the automated tests. Native runtime tests use workerd and SQLite-backed Durable Objects. Component-only browser mode does not test iframe navigation or the browser's sign-in restrictions. See [Testing](TESTING.md) for the commands.\n\nLive GitHub sign-in, Cloudflare deployment, and production CPU usage were not checked by this script. Complete the [deployed-service checks](DEPLOY.md) before switching a live embed.\n`);
