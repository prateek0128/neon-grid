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
  server = createGameServer({ allowedOrigins: [origin], matchDurationTicks: 300,
    verifyToken: async token => ({ userId: users[token.startsWith('memberA') ? 0 : 1]!, expiresAt: Date.now() + 60000 }),
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
async function finish() { await vi.advanceTimersByTimeAsync(10080); }
it('finalizes once, sends identical results to two clients and freezes late gameplay', async () => {
  const a = await connect(); const b = await connect(1); await finish();
  const event = await a.next(m => m.type === 'match_complete'); expect(await b.next(m => m.type === 'match_complete')).toEqual(event);
  const frozen = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.match?.phase === 'RESULTS');
  a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence: 0, movement: { x: 1, y: 0 } }));
  a.ws.send(JSON.stringify({ type: 'ability', version: 1, sessionId: a.welcome.sessionId, sequence: 1, ability: 'shield' }));
  expect(await a.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'MATCH_ENDED' });
  await vi.advanceTimersByTimeAsync(1000);
  const after = await a.next<Snapshot>(m => m.type === 'snapshot' && m.tick > frozen.tick);
  expect(after.gameplay).toEqual(frozen.gameplay); expect(after.players[0]!.position).toEqual(frozen.players[0]!.position);
  expect(a.messages.filter(m => m.type === 'match_complete')).toHaveLength(0);
  a.ws.close(); await once(a.ws, 'close'); const restored = await connect();
  expect(restored.snapshot.gameplay).toEqual(frozen.gameplay); expect(restored.welcome.playerId).toBe(a.welcome.playerId);
}, 30000);
it('rejects active replay, nonhost actions, stale generation and insufficient connected roster', async () => {
  const a = await connect(); const b = await connect(1);
  request(a, 0); expect(await a.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'INVALID_TRANSITION' });
  await finish(); request(b, 0); expect(await b.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'HOST_ONLY' });
  request(b, 1, b.snapshot.epoch, 'return'); expect(await b.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'HOST_ONLY' });
  request(a, 1, randomUUID()); expect(await a.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'STALE_MATCH' });
  b.ws.close(); await once(b.ws, 'close'); request(a, 2); expect(await a.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'NOT_READY' });
});
it('replays once with new generation/sessions, clean state and stable identities', async () => {
  const a = await connect(); const b = await connect(1); await finish();
  request(a, 0); await Promise.all([once(a.ws, 'close'), once(b.ws, 'close')]);
  const nextA = await connect(); const nextB = await connect(1);
  expect(nextA.snapshot.epoch).not.toBe(a.snapshot.epoch); expect(nextA.welcome.sessionId).not.toBe(a.welcome.sessionId);
  expect(nextA.welcome.playerId).toBe(a.welcome.playerId); expect(nextB.welcome.playerId).toBe(b.welcome.playerId);
  expect(nextA.snapshot.gameplay!.match).toMatchObject({ phase: 'ACTIVE', results: null, endedAtTick: null });
  expect(nextA.snapshot.gameplay!.vitals!.every(p => p.health === 100 && p.respawnAtTick === 0 && p.invulnerableUntilTick === 0)).toBe(true);
  expect(nextA.snapshot.gameplay!.scores.every(p => p.score === 0 && p.combo === 0)).toBe(true);
  expect(nextA.snapshot.gameplay!.healthEvents).toHaveLength(0); expect(nextA.snapshot.gameplay!.hazards![0]!.phase).toBe('idle');
  request(nextA, 0, a.snapshot.epoch); expect(await nextA.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'STALE_MATCH' });
  request(nextA, 1, a.snapshot.epoch, 'return'); expect(await nextA.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'STALE_MATCH' });
  nextA.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence: 2, movement: { x: 1, y: 0 } }));
  expect(await nextA.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_SESSION' });
});
it('serializes repeated requests and authorizes the transferred host before returning', async () => {
  const a = await connect(); const b = await connect(1); await finish();
  let release!: () => void; authorizationGate = new Promise<void>(resolve => { release = resolve; });
  request(a, 0); request(a, 1); expect(await a.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'BUSY' });
  host = 1; release(); authorizationGate = null;
  expect(await a.next(m => m.type === 'lifecycle_rejected')).toMatchObject({ reason: 'HOST_ONLY' });
  request(b, 0, b.snapshot.epoch, 'return'); expect(await b.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  await vi.advanceTimersByTimeAsync(1000); expect(active).toBe(false);
});
it('fences pending actions when the room is removed', async () => {
  const a = await connect(); await connect(1); await finish();
  let release!: () => void; authorizationGate = new Promise<void>(resolve => { release = resolve; }); request(a, 0);
  await new Promise(resolve => setTimeout(resolve, 10)); active = false; await vi.advanceTimersByTimeAsync(1000); release(); authorizationGate = null;
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
});

it('does not resurrect a returned match from an old in-flight room snapshot', async () => {
  const a = await connect(); await connect(1); await finish();
  let release!: () => void; tickGate = new Promise<void>(resolve => { release = resolve; });
  await vi.advanceTimersByTimeAsync(1000); request(a, 0, a.snapshot.epoch, 'return');
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  release(); tickGate = null; await new Promise(resolve => setTimeout(resolve, 10));
  // Permit authorization deliberately: the closed-arena fence must still prevent resurrection.
  allowClosedAuthorization = true;
  const probe = new WebSocket(url, { origin }); sockets.push(probe);
  await once(probe, 'open'); const received = once(probe, 'message');
  probe.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 'memberA'.repeat(5), roomId, matchId: databaseMatch }));
  expect(JSON.parse(String((await received)[0]))).toMatchObject({ type: 'error', code: 'NOT_MEMBER' });
});
it('shares extraction and restores its frozen position beyond the position grace before replay clears it', async () => {
  const a = await connect(); const b = await connect(1);
  for (let sequence = 0; sequence < 10; sequence++) {
    a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence, movement: { x: 1, y: 1 } }));
    await new Promise(resolve => setTimeout(resolve, 5)); await vi.advanceTimersByTimeAsync(100);
  }
  const extracted = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.extraction?.players.some(p => p.id === ids[0] && p.outcome === 'extracted') === true);
  const shared = await b.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.extraction?.players.some(p => p.id === ids[0] && p.outcome === 'extracted') === true);
  expect(shared.gameplay!.extraction).toEqual(extracted.gameplay!.extraction);
  const position = extracted.players.find(p => p.id === ids[0])!.position;
  const closed = once(a.ws, 'close'); a.ws.close(); await closed;
  await vi.advanceTimersByTimeAsync(16000);
  const restored = await connect();
  expect(restored.snapshot.gameplay!.extraction!.players.find(p => p.id === ids[0])!.outcome).toBe('extracted');
  expect(restored.snapshot.players.find(p => p.id === ids[0])!.position).toEqual(position);
  const replayClosed = once(restored.ws, 'close'); request(restored, 0); await replayClosed;
  await new Promise(resolve => setTimeout(resolve, 10));
  const next = await connect();
  expect(next.snapshot.gameplay!.extraction!.players.every(p => p.outcome === 'alive' && p.extractedAtTick === null)).toBe(true);
});
