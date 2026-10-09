import { build } from 'esbuild';

await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['ws', '@supabase/supabase-js'], outfile: 'dist/index.js' });
