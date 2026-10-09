import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createAuthFixture } from './auth-fixture.ts';

// Only Playwright launches this fixture. There is no alternate authentication path in the app/server.
const fixture = createAuthFixture();
fixture.http.listen(9100, '127.0.0.1');
await once(fixture.http, 'listening');
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:9100', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', HOST: '127.0.0.1', PORT: '9101', ALLOWED_ORIGINS: 'http://127.0.0.1:5173' },
});
server.on('exit', code => { fixture.http.close(); process.exit(code ?? 1); });
function stop() { server.kill('SIGTERM'); fixture.http.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
