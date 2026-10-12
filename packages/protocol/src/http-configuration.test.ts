import { expect, it } from 'vitest';
import { validateBrowserEnvironment } from './configuration.ts';
import { parseHttpGameResponse } from './index.ts';
const env = { VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', VITE_GAME_SERVER_URL: 'https://game.example.com/' };
it('accepts HTTPS and normalizes existing socket configuration to HTTP without opening sockets', () => {
  expect(validateBrowserEnvironment(env, { production: true }).serverUrl).toBe('https://game.example.com/');
  expect(validateBrowserEnvironment({ ...env, VITE_GAME_SERVER_URL: 'wss://game.example.com/ws' }, { production: true }).serverUrl).toBe('https://game.example.com/');
});
it.each(['http://game.example.com/', 'https://game.example.com/ws', 'https://game.example.com/?token=secret', 'https://user:secret@game.example.com/', 'https://localhost/'])('rejects unsafe production HTTP configuration', value => {
  expect(() => validateBrowserEnvironment({ ...env, VITE_GAME_SERVER_URL: value }, { production: true })).toThrow();
});
it('bounds and validates HTTP response envelopes', () => {
  expect(parseHttpGameResponse('{"messages":[]}')).toEqual({ messages: [] });
  expect(parseHttpGameResponse('{"messages":[],"position":1}')).toBeNull();
  expect(parseHttpGameResponse(JSON.stringify({ messages: Array(35).fill({ type: 'authenticated', version: 1 }) }))).toBeNull();
});
