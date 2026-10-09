import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createAuthFixture } from './auth-fixture.ts';
import { createTestDatabase } from './database.ts';

// Only Playwright launches this fixture. There is no alternate authentication path in the app/server.
const database = await createTestDatabase();
const fixture = createAuthFixture(database);
fixture.http.listen(9100, '127.0.0.1');
await once(fixture.http, 'listening');
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:9100', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', SUPABASE_SERVER_KEY: 'sb_secret_test_fixture',
    NODE_ENV:'development', ENABLE_MOVEMENT_TEST_ARENA:'true', HOST: '127.0.0.1', PORT: '9101', ALLOWED_ORIGINS: 'http://127.0.0.1:5173' },
});
server.on('exit', code => { fixture.http.close(); process.exit(code ?? 1); });
function stop() { server.kill('SIGTERM'); fixture.http.close(); void database.db.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
