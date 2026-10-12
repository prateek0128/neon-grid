import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectGame } from './legacy-websocket-connection';
import { createGameplay, gameplaySnapshot } from '@neon/simulation';
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
it('keeps an unavailable match unsynchronized, retries, then installs the initial authoritative snapshot', async () => {
  const views = vi.fn(); const stop = connectGame(auth(), 'wss://game.example.com/ws', views);
  try {
    await vi.advanceTimersByTimeAsync(0);
    TestSocket.instances[0]!.close();
    expect(views.mock.lastCall?.[0]).toMatchObject({ status: 'reconnecting', playerId: null, snapshot: null });
    await vi.advanceTimersByTimeAsync(800);
    const recovered = TestSocket.instances[1]!;
    recovered.readyState = TestSocket.OPEN; recovered.onopen?.();
    const id = '11111111-1111-4111-8111-111111111111';
    recovered.onmessage?.({ data: JSON.stringify({ type: 'welcome', version: 1, playerId: id, sessionId: id, epoch: id, tickRate: 30 }) });
    expect(views.mock.lastCall?.[0]).toMatchObject({ status: 'connected', snapshot: null });
    recovered.onmessage?.({ data: JSON.stringify({ type: 'snapshot', version: 1, epoch: id, tick: 0, players: [], gameplay: gameplaySnapshot(createGameplay(2700, id)) }) });
    expect(views.mock.lastCall?.[0].snapshot).toMatchObject({ epoch: id, tick: 0, gameplay: { tick: 0, match: { id, durationTicks: 2700 } } });
    expect(TestSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(TestSocket.instances).toHaveLength(2);
  } finally { stop(); }
  expect(vi.getTimerCount()).toBe(0);
});
