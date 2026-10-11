import { spawnSync } from 'node:child_process';
const result = spawnSync('pnpm', ['build'], { stdio: 'inherit', env: { ...process.env, NEON_LOCAL_BUILD: 'true' } });
process.exit(result.status ?? 1);
