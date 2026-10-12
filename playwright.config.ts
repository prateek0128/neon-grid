import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.NEON_TEST_WEB_PORT ?? '5173');
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error('Use a valid NEON_TEST_WEB_PORT between 1024 and 65535.');
const browserUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: browserUrl, headless: true, trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm exec tsx tests/browser-services.ts', url: 'http://127.0.0.1:9101/health', reuseExistingServer: false, timeout: 20000, env: { NEON_TEST_BROWSER_ORIGIN: browserUrl } },
    { command: `pnpm --filter @neon/web dev --port ${webPort}`, url: browserUrl, reuseExistingServer: false, timeout: 20000,
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:9100', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', VITE_GAME_SERVER_URL: 'http://127.0.0.1:9101/' } },
  ],
});
