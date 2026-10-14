import { execSync } from 'node:child_process';
if (process.env.WRANGLER_COMMAND !== 'types') execSync('npm run build', { stdio: 'inherit' });
