import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage, Snapshot, Welcome } from '@neon/protocol';
import { createGameServer } from './legacy-websocket-server.ts';
import type { RoomAuthorization } from './rooms.ts';
const origin = 'http://localhost:5173'; const roomId = randomUUID(); const databaseMatch = randomUUID();
const ids = [randomUUID(), randomUUID()]; const users = [randomUUID(), randomUUID()];
let host = 0; let active = true; let authorizationGate: Promise<void> | null; let tickGate: Promise<void> | null; let allowClosedAuthorization: boolean; let server: ReturnType<typeof createGameServer>; let url: string;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); const start = Date.now();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
  host = 0; active = true; authorizationGate = null; tickGate = null; allowClosedAuthorization = false;
  server = createGameServer({ allowedOrigins: [origin], matchDurationTicks: 2700,
    verifyToken: async token => ({ userId: users[token.startsWith('memberA') ? 0 : 1]!, expiresAt: Date.now() + 120000 }),
    rooms: { tick: async () => { const states = active ? [{ roomId, matchId: databaseMatch, startedAt: new Date().toISOString(), members: ids.map((id, n) => ({ id, userId: users[n]!, slot: n + 1 })) }] : []; if (tickGate) await tickGate; return states; },
      authorize: async token => { if (authorizationGate) await authorizationGate; const n = token.startsWith('memberA') ? 0 : 1; return active || allowClosedAuthorization ? { id: ids[n]!, slot: n + 1, host: host === n, revision: 1 } as RoomAuthorization : null; },
      returnLobby: async () => { active = false; return true; } },
  });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening'); url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
});
afterEach(async () => { sockets.splice(0).forEach(ws => ws.terminate()); await server.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function connect(n = 0) {
  const ws = new WebSocket(url, { origin }); sockets.push(ws); const messages: ServerMessage[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString()))); await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: (n ? 'memberB' : 'memberA').repeat(5), roomId, matchId: databaseMatch }));
  const next = async <T extends ServerMessage>(predicate: (m: ServerMessage) => boolean): Promise<T> => {
    for (let n = 0; n < 300; n++) { const i = messages.findIndex(predicate); if (i >= 0) return messages.splice(i, 1)[0] as T; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('Lifecycle message not received');
  };
  const welcome = await next<Welcome>(m => m.type === 'welcome');
  const snapshot = await next<Snapshot>(m => m.type === 'snapshot');
  return { ws, next, welcome, snapshot, messages };
}
function request(client: Awaited<ReturnType<typeof connect>>, sequence: number, matchId = client.snapshot.epoch, action = 'replay') {
  client.ws.send(JSON.stringify({ type: 'lifecycle', version: 1, sessionId: client.welcome.sessionId, sequence, matchId, action }));
}
it('sends identical moving hazards, recovers them on reconnect and preserves extraction/results/replay/lobby lifecycle', async () => {
  const a = await connect(); const b = await connect(1);
  await vi.advanceTimersByTimeAsync(32000);
  const first = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.hazards?.[0]?.phase === 'active' && !!m.gameplay.hazards[0].motion);
  const peer = await b.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.tick === first.gameplay?.tick);
  expect(peer.gameplay!.hazards).toEqual(first.gameplay!.hazards); expect(peer.gameplay!.difficultyStage).toBe(2);
  expect(first.gameplay!.hazards![0]!.pattern).toBe('horizontal-up');
  const frozenClock = first.gameplay!.tick;
  const closed = once(b.ws, 'close'); b.ws.close(); await closed;
  const restored = await connect(1);
  const latest = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.tick === restored.snapshot.gameplay?.tick);
  expect(restored.snapshot.gameplay!.hazards).toEqual(latest.gameplay!.hazards);
  expect(restored.snapshot.gameplay!.hazards![0]!.motion).toBeDefined(); expect(restored.snapshot.gameplay!.tick).toBeGreaterThanOrEqual(frozenClock);
  await vi.advanceTimersByTimeAsync(39000);
  const extraction = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.extraction?.phase === 'open');
  expect(extraction.gameplay!.difficultyStage).toBe(3);
  await vi.advanceTimersByTimeAsync(20000);
  const final = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.match?.phase === 'RESULTS');
  expect(final.gameplay!.extraction!.phase).toBe('lockdown');
  request(a, 0, final.epoch); const replayClose = once(a.ws, 'close'); await replayClose;
  const replay = await connect(); const replayB = await connect(1);
  expect(replay.snapshot.gameplay!.difficultyStage).toBe(1); expect(replay.snapshot.gameplay!.hazards![0]!.motion).toBeUndefined();
  expect(replay.snapshot.gameplay!.extraction!.phase).toBe('closed');
  request(replay, 0, replay.snapshot.epoch, 'return');
  await replayB.next(m => m.type === 'error' && m.code === 'MATCH_UNAVAILABLE'); expect(active).toBe(false);
});
