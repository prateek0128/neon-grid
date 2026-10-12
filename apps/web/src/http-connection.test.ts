import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGameplay, gameplaySnapshot } from '@neon/simulation';
import { connectGame } from './connection';
let keyboard: (movement: { x: number; y: number }) => void;
vi.mock('./keyboard', () => ({ attachKeyboard: (callback: typeof keyboard) => { keyboard = callback; return vi.fn(); } }));
const id = '11111111-1111-4111-8111-111111111111';
const snapshot = (tick = 0) => ({ type: 'snapshot', version: 1, epoch: id, tick, players: [], gameplay: gameplaySnapshot(createGameplay(2700, id)) });
const welcome = { type: 'welcome', version: 1, playerId: id, sessionId: id, epoch: id, tickRate: 30 };
function auth() {
  return { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'fixture-only-valid-token' } }, error: null })),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } } as unknown as SupabaseClient;
}
const response = (messages: unknown[], status = 200) => new Response(JSON.stringify({ messages }), { status });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses HTTP only, installs the authoritative clock, batches input and cleans up polling', async () => {
  const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => response(JSON.parse(String(options.body)).requestId ? [welcome, snapshot()] : [snapshot()]));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('WebSocket', class { constructor() { throw Error('Forbidden'); } });
  const view = vi.fn(), stop = connectGame(auth(), 'https://game.example.com/', view, { roomId: id, matchId: id });
  await vi.advanceTimersByTimeAsync(0);
  expect(view.mock.lastCall?.[0]).toMatchObject({ status: 'connected', snapshot: { gameplay: { match: { durationTicks: 2700 } } } });
  keyboard({ x: 1, y: 0 }); await vi.advanceTimersByTimeAsync(0);
  const sent = JSON.parse(String(fetcher.mock.calls[1]![1].body));
  expect(sent.actions[0]).toMatchObject({ type: 'input', movement: { x: 1, y: 0 } });
  stop(); const calls = fetcher.mock.calls.length; await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
});
it('never overlaps polls while a response is pending and ignores responses after cleanup', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetcher);
  const view = vi.fn(), stop = connectGame(auth(), 'https://game.example.com/', view);
  await vi.advanceTimersByTimeAsync(0); keyboard({ x: 1, y: 0 }); await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const count = view.mock.calls.length; stop(); resolve(response([welcome, snapshot()]));
  await vi.advanceTimersByTimeAsync(0); expect(view.mock.calls).toHaveLength(count);
});
it('backs off failed authority and recovers without a client-owned clock', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'AUTHORITY_UNAVAILABLE' }), { status: 503 })).mockResolvedValue(response([welcome, snapshot()]));
  vi.stubGlobal('fetch', fetcher); const view = vi.fn(), stop = connectGame(auth(), 'https://game.example.com/', view);
  await vi.advanceTimersByTimeAsync(0);
  expect(view.mock.lastCall?.[0]).toMatchObject({ status: 'reconnecting', snapshot: null });
  expect(view.mock.lastCall?.[0].detail).toContain('Game server unavailable');
  keyboard({ x: 1, y: 0 }); // Input during an outage must not bypass error backoff.
  await vi.advanceTimersByTimeAsync(499); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(view.mock.lastCall?.[0].status).toBe('connected'); stop();
});
it('retains the identical sequenced action body after a lost response', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([welcome, snapshot()])).mockRejectedValueOnce(Error('network')).mockResolvedValue(response([snapshot()]));
  vi.stubGlobal('fetch', fetcher); const stop = connectGame(auth(), 'https://game.example.com/', vi.fn());
  await vi.advanceTimersByTimeAsync(100);
  const body = fetcher.mock.calls[1]![1].body;
  await vi.advanceTimersByTimeAsync(500); expect(fetcher.mock.calls[2]![1].body).toBe(body); stop();
});
it('rejects malformed snapshot responses visibly rather than accepting client state', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response([{ ...snapshot(), players: [{ id, slot: 1, position: { x: 'forged', y: 0 }, connected: true, lastSequence: 0 }] }])));
  const view = vi.fn(), stop = connectGame(auth(), 'https://game.example.com/', view);
  await vi.advanceTimersByTimeAsync(0); expect(view.mock.lastCall?.[0]).toMatchObject({ status: 'reconnecting', snapshot: null }); stop();
});

it('resumes persisted transport metadata without resetting action sequence', async () => {
  const values = new Map([['neon-grid-http:https://game.example.com/:lab:lab', JSON.stringify({ sessionId: id, nextSequence: 8 })]]);
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const fetcher = vi.fn(async (_url: unknown, _options: RequestInit) => response([welcome, snapshot()]));
  vi.stubGlobal('fetch', fetcher); const stop = connectGame(auth(), 'https://game.example.com/', vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(String(fetcher.mock.calls[0]![0])).toContain('/game/resume');
  keyboard({ x: 1, y: 0 }); await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [unknown, RequestInit])[1].body)).actions[0].sequence).toBe(8);
  stop(); expect(values.size).toBe(0);
});
it('ignores older snapshots within an authoritative generation', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([welcome, { ...snapshot(), gameplay: undefined, tick: 10 }])).mockResolvedValue(response([{ ...snapshot(), gameplay: undefined, tick: 9 }]));
  vi.stubGlobal('fetch', fetcher); const view = vi.fn(), stop = connectGame(auth(), 'https://game.example.com/', view);
  await vi.advanceTimersByTimeAsync(100); expect(view.mock.lastCall?.[0].snapshot.tick).toBe(10); stop();
});
it('resynchronizes a rejected stale sequence instead of retrying the same stale body forever', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([welcome, snapshot()]))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'STALE_SEQUENCE' }), { status: 409 }))
    .mockResolvedValue(response([welcome, snapshot()]));
  vi.stubGlobal('fetch', fetcher);
  const stop = connectGame(auth(), 'https://game.example.com/', vi.fn());
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(500);
  expect(String(fetcher.mock.calls[2]![0])).toContain('/game/resume');
  stop();
});
