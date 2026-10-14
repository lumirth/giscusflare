import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function extractedPackage(prefix) {
  const consumer = await mkdtemp(prefix), dispose = () => rm(consumer, { recursive: true, force: true });
  try {
    const [packed] = Object.values(JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], { encoding: 'utf8' })));
    const directory = join(consumer, 'node_modules/giscusflare');
    await mkdir(directory, { recursive: true });
    execFileSync('tar', ['-xzf', join(consumer, packed.filename), '--strip-components=1', '-C', directory]);
    for (const dependency of Object.keys(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies)) {
      const destination = join(consumer, 'node_modules', dependency); await mkdir(dirname(destination), { recursive: true });
      await symlink(resolve('node_modules', dependency), destination, 'dir');
    }
    return { consumer, directory, packed, dispose };
  } catch (error) { await dispose(); throw error; }
}
