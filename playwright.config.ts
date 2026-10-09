import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm exec tsx tests/browser-services.ts', url: 'http://127.0.0.1:9101/health', reuseExistingServer: false, timeout: 20000 },
    { command: 'pnpm --filter @neon/web dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 20000,
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:9100', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', VITE_GAME_SERVER_URL: 'ws://127.0.0.1:9101/ws' } },
  ],
});
