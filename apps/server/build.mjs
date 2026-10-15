import { build } from 'esbuild';

await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['@supabase/supabase-js', 'ws'], outfile: 'dist/index.js' });
