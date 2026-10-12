import { expect, it } from 'vitest';
import { rejectBrowserSecrets, validateBrowserEnvironment, validatePublicKey } from './legacy-websocket-configuration.ts';
const env = { VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture', VITE_GAME_SERVER_URL: 'wss://game.example.com/ws' };
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.fixture`;
it('accepts secure public production configuration and anon keys', () => {
  expect(validateBrowserEnvironment(env, { production: true })).toEqual({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY, serverUrl: env.VITE_GAME_SERVER_URL });
  expect(() => validatePublicKey(jwt('anon'))).not.toThrow();
});
it.each(['http://game.example.com/ws', 'ws://game.example.com/ws', 'ws://127.0.0.1:8787/ws', 'wss://localhost/ws', 'wss://game.example.com', 'wss://user:private@game.example.com/ws', 'wss://game.example.com/ws?token=private', 'wss://game.example.com/ws#private', 'not a url'])('rejects unsafe production game endpoint without echoing values', value => {
  expect(() => validateBrowserEnvironment({ ...env, VITE_GAME_SERVER_URL: value }, { production: true })).toThrow();
});
it('allows loopback only explicitly and never uses ws on an HTTPS page', () => {
  const local = { ...env, VITE_GAME_SERVER_URL: 'ws://127.0.0.1:8787/ws' };
  expect(() => validateBrowserEnvironment(local, { production: true, allowLocal: true })).not.toThrow();
  expect(() => validateBrowserEnvironment(local, { production: true, allowLocal: true, pageProtocol: 'https:' })).toThrow('wss://');
  expect(() => validateBrowserEnvironment({ ...local, VITE_GAME_SERVER_URL: 'ws://remote.example.com/ws' }, { production: true, allowLocal: true })).toThrow();
});
it.each(['', 'YOUR_PUBLISHABLE_KEY', 'sb_secret_test_fixture', jwt('service_role'), jwt('authenticated'), 'sb_publishable_ unsafe'])('rejects nonpublic API keys', key => {
  expect(() => validatePublicKey(key)).toThrow();
});
it.each(['http://project.supabase.co', 'https://project.supabase.co/rest', 'https://project.supabase.co?key=private', 'https://user:private@project.supabase.co', 'malformed'])('validates the Supabase base URL', url => {
  expect(() => validateBrowserEnvironment({ ...env, VITE_SUPABASE_URL: url }, { production: true })).toThrow();
});
it('blocks missing configuration and any browser-prefixed server credential', () => {
  expect(() => validateBrowserEnvironment({}, { production: true })).toThrow('VITE_SUPABASE_URL');
  for (const name of ['VITE_SUPABASE_SERVER_KEY', 'VITE_SERVICE_ROLE_KEY', 'VITE_PRIVATE_KEY', 'VITE_CUSTOM_VALUE']) expect(() => rejectBrowserSecrets({ [name]: 'sb_secret_test_fixture' })).toThrow();
  expect(() => rejectBrowserSecrets({ SUPABASE_SERVER_KEY: 'sb_secret_test_fixture', VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY })).not.toThrow();
});
