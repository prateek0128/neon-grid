import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectGame } from './connection';
vi.mock('./keyboard', () => ({ attachKeyboard: () => vi.fn() }));
class TestSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = 0; onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null; onclose: ((event: { code: number }) => void) | null = null;
  send = vi.fn();
  constructor(readonly url: string) { TestSocket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}
let authEvent: (event: string, session: null) => void;
function auth(getSession = vi.fn(async () => ({ data: { session: { access_token: 'fixture-only-token' } }, error: null }))) {
  return { auth: { getSession, onAuthStateChange: (callback: typeof authEvent) => { authEvent = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } as unknown as SupabaseClient;
}
beforeEach(() => { vi.useFakeTimers(); TestSocket.instances = []; vi.stubGlobal('WebSocket', TestSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('opens one exact production endpoint per attempt, ignores stale closes and cancels retries on cleanup', async () => {
  const view = vi.fn(); const stop = connectGame(auth(), 'wss://neon-grid-server-uske.onrender.com/ws', view);
  await vi.advanceTimersByTimeAsync(0);
  expect(TestSocket.instances).toHaveLength(1); const first = TestSocket.instances[0]!;
  expect(first.url).toBe('wss://neon-grid-server-uske.onrender.com/ws'); first.close();
  expect(view.mock.lastCall?.[0].detail).toContain('1006');
  await vi.advanceTimersByTimeAsync(800); expect(TestSocket.instances).toHaveLength(2);
  first.onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(800); expect(TestSocket.instances).toHaveLength(2);
  stop(); await vi.advanceTimersByTimeAsync(20000); expect(TestSocket.instances).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
});
it.each(['cleanup', 'signout'])('does not open a socket when %s occurs during session lookup', async action => {
  let resolve!: (session: { data: { session: { access_token: string } }; error: null }) => void;
  const lookup = vi.fn(() => new Promise<{ data: { session: { access_token: string } }; error: null }>(done => { resolve = done; }));
  const stop = connectGame(auth(lookup), 'wss://neon-grid-server-uske.onrender.com/ws', vi.fn());
  if (action === 'cleanup') stop(); else authEvent('SIGNED_OUT', null);
  resolve({ data: { session: { access_token: 'fixture-only-token' } }, error: null });
  await vi.advanceTimersByTimeAsync(0); expect(TestSocket.instances).toHaveLength(0); stop(); expect(vi.getTimerCount()).toBe(0);
});
