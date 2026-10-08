import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function evidence(name) {
  const hash = createHash('sha256');
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  for (const path of new Set(paths)) {
    if (!existsSync(root + path)) continue;
    hash.update(path + '\0'); hash.update(readFileSync(root + path)); hash.update('\0');
  }
  return { name, source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sha256: hash.digest('hex') }, startedAt: new Date().toISOString(), node: process.version, github: 'local test-only simulation', status: 'not-run', checks: [], details: '' };
}
