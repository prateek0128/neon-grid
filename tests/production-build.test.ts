import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('rejects unsafe production configuration and excludes server credentials from a real browser build', () => {
  const output = mkdtempSync(join(tmpdir(), 'neon-build-'));
  const privateSentinel = 'sb_secret_phase4_build_must_stay_private';
  const base = { ...process.env, NODE_ENV: 'production', NEON_LOCAL_BUILD: 'false', VITE_SUPABASE_URL: 'https://build-fixture.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_phase4_build_fixture', VITE_GAME_SERVER_URL: 'wss://game.example.com/ws', SUPABASE_SERVER_KEY: privateSentinel };
  const build = (patch: Record<string, string> = {}) => spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', output], {
    cwd: resolve('apps/web'), env: { ...base, ...patch }, encoding: 'utf8', timeout: 30000,
  });
  try {
    const local = build({ VITE_GAME_SERVER_URL: 'ws://127.0.0.1:8787/ws' });
    expect(local.status).not.toBe(0); expect(local.stderr).toContain('Production requires a public wss://');
    const leaked = build({ VITE_SERVER_KEY: privateSentinel });
    expect(leaked.status).not.toBe(0); expect(leaked.stderr).toContain('Remove server-only credentials');
    expect(leaked.stdout + leaked.stderr).not.toContain(privateSentinel);
    const safe = build(); expect(safe.status, safe.stderr).toBe(0);
    const assets = readdirSync(join(output, 'assets')).map(name => readFileSync(join(output, 'assets', name), 'utf8')).join('\n');
    expect(assets).toContain(base.VITE_GAME_SERVER_URL); expect(assets).toContain(base.VITE_SUPABASE_PUBLISHABLE_KEY);
    expect(assets.includes(privateSentinel)).toBe(false); expect(assets.includes('/movement-test')).toBe(false);
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 60000);
