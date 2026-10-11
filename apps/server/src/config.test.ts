import { expect, it } from 'vitest';
import { serverConfiguration, validateOrigins } from './config.ts';
const env = { NODE_ENV: 'production', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', SUPABASE_SERVER_KEY: 'sb_secret_test_fixture', ALLOWED_ORIGINS: 'https://web.example.com', ENABLE_MOVEMENT_TEST_ARENA: 'false' };
it('validates production startup and binds externally without a silent local default', () => {
  expect(serverConfiguration(env)).toMatchObject({ host: '0.0.0.0', port: 10000, allowTestArena: false, matchDurationTicks: 2700, origins: ['https://web.example.com'] });
});
it.each([
  { NODE_ENV: '' }, { NODE_ENV: 'staging' }, { SUPABASE_URL: '' }, { SUPABASE_URL: 'http://127.0.0.1:9100' }, { SUPABASE_URL: 'https://user:secret@project.supabase.co' },
  { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test_fixture' }, { SUPABASE_SERVER_KEY: '' }, { SUPABASE_SERVER_KEY: 'sb_publishable_test_fixture' },
  { ALLOWED_ORIGINS: '' }, { ALLOWED_ORIGINS: 'http://localhost:5173' }, { ALLOWED_ORIGINS: 'https://*.vercel.app' },
  { PORT: '0' }, { PORT: '65536' }, { PORT: 'abc' }, { HOST: 'bad' }, { ENABLE_MOVEMENT_TEST_ARENA: 'true' }, { ENABLE_MOVEMENT_TEST_ARENA: '1' },
  { MATCH_DURATION_SECONDS: '9' }, { MATCH_DURATION_SECONDS: '3601' }, { MATCH_DURATION_SECONDS: '1.5' },
])('rejects invalid startup configuration', patch => expect(() => serverConfiguration({ ...env, ...patch })).toThrow());
it.each(['*', 'null', 'https://*.example.com', 'https://web.example.com/', 'https://web.example.com/path', 'https://user:private@web.example.com', 'https://web.example.com?private', 'ftp://web.example.com'])('rejects malformed/wildcard origin %s', origin => expect(() => validateOrigins([origin])).toThrow());
it('allows explicit development fixtures and validates legacy key roles without logging them', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
  const config = serverConfiguration({ ...env, NODE_ENV: 'development', SUPABASE_URL: 'http://127.0.0.1:9100', ALLOWED_ORIGINS: 'http://localhost:5173', ENABLE_MOVEMENT_TEST_ARENA: 'true', SUPABASE_PUBLISHABLE_KEY: jwt('anon'), SUPABASE_SERVER_KEY: jwt('service_role') });
  expect(config).toMatchObject({ host: '127.0.0.1', port: 8787, allowTestArena: true });
  expect(() => serverConfiguration({ ...env, SUPABASE_SERVER_KEY: jwt('anon') })).toThrow('SUPABASE_SERVER_KEY');
});
