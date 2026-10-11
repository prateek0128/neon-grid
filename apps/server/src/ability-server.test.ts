import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage, Snapshot, Welcome } from '@neon/protocol';
import { createGameServer } from './server.ts';

const origin = 'http://localhost:5173'; const userId = randomUUID(); const memberId = randomUUID(); const roomId = randomUUID();
let matchId: string; let active: boolean; let server: ReturnType<typeof createGameServer>; let url: string;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  // Real socket I/O and auth timeout; only simulation/reconciliation intervals and monotonic time are controlled.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const start = Date.now();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
  active = true; matchId = randomUUID();
  server = createGameServer({ allowedOrigins: [origin], allowTestArena: true,
    verifyToken: async token => ({ userId: token.startsWith('member') ? userId : randomUUID(), expiresAt: Date.now() + 60000 }),
    rooms: { tick: async () => active ? [{ roomId, matchId, startedAt: new Date().toISOString(), members: [{ userId, id: memberId, slot: 1 }] }] : [],
      authorize: async token => active && token.startsWith('member') ? { id: memberId, slot: 1 } : null },
  });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
});
afterEach(async () => { sockets.splice(0).forEach(ws => ws.terminate()); await server.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function connect(kind = 'member', room = true, authenticate = true) {
  const ws = new WebSocket(url, { origin }); sockets.push(ws);
  const messages: ServerMessage[] = []; ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const next = async <T extends ServerMessage>(predicate: (m: ServerMessage) => boolean): Promise<T> => {
    for (let n = 0; n < 300; n++) {
      const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0] as T;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Expected ability message did not arrive');
  };
  await once(ws, 'open');
  if (authenticate) ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: kind.repeat(10), ...(room ? { roomId, matchId } : {}) }));
  return { ws, next };
}
function ability(ws: WebSocket, welcome: Welcome, sequence: number, kind = 'shield') {
  ws.send(JSON.stringify({ type: 'ability', version: 1, sessionId: welcome.sessionId, sequence, ability: kind }));
}

it('runs a validated dash in the same movement loop and enforces cooldown without closing the socket', async () => {
  const a = await connect(); const welcome = await a.next<Welcome>(m => m.type === 'welcome');
  ability(a.ws, welcome, 0, 'dash');
  expect(await a.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'NO_DIRECTION' });
  a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: welcome.sessionId, sequence: 1, movement: { x: 1, y: 0 } }));
  ability(a.ws, welcome, 2, 'dash');
  const activated = await a.next<Snapshot>(m => m.type === 'snapshot' && !!m.gameplay?.abilityEvents?.some(e => e.ability === 'dash'));
  expect(activated.gameplay!.abilities![0]!.dashReadyAtTick).toBe(150);
  ability(a.ws, welcome, 3, 'dash'); expect(await a.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'COOLDOWN' });
  expect(a.ws.readyState).toBe(WebSocket.OPEN);
  await vi.advanceTimersByTimeAsync(208);
  const moved = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay!.tick >= 6);
  expect(moved.players[0]!.position.x).toBeCloseTo(446); expect(moved.gameplay!.abilityEvents).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1200);
  ability(a.ws, welcome, 4, 'dash'); expect(await a.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'COOLDOWN' });
});

it('restores active shield/cooldowns on reconnect, expires after two seconds and permits activation at twelve seconds', async () => {
  const a = await connect(); const welcome = await a.next<Welcome>(m => m.type === 'welcome');
  ability(a.ws, welcome, 0);
  const first = await a.next<Snapshot>(m => m.type === 'snapshot' && !!m.gameplay?.abilityEvents?.length);
  expect(first.gameplay!.abilities![0]).toMatchObject({ shieldUntilTick: 60, shieldReadyAtTick: 360 });
  a.ws.close(); await once(a.ws, 'close'); await vi.advanceTimersByTimeAsync(500);
  const b = await connect(); const bw = await b.next<Welcome>(m => m.type === 'welcome');
  const restored = await b.next<Snapshot>(m => m.type === 'snapshot');
  expect(restored.gameplay!.tick).toBeLessThan(60);
  expect(restored.gameplay!.abilities![0]).toEqual(first.gameplay!.abilities![0]);
  ability(b.ws, bw, 0); expect(await b.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'COOLDOWN' });
  await vi.advanceTimersByTimeAsync(1510);
  const expired = await b.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay!.tick >= 60);
  expect(expired.gameplay!.tick >= expired.gameplay!.abilities![0]!.shieldUntilTick).toBe(true);
  await vi.advanceTimersByTimeAsync(10050);
  ability(b.ws, bw, 1);
  const second = await b.next<Snapshot>(m => m.type === 'snapshot' && (m.gameplay?.abilityEvents?.length ?? 0) === 2);
  expect(second.gameplay!.abilities![0]!.shieldUntilTick).toBe(second.gameplay!.tick + 60);
});

it('rejects stale dash directions and excessive ability spam', async () => {
  const a = await connect(); const w = await a.next<Welcome>(m => m.type === 'welcome');
  a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: w.sessionId, sequence: 0, movement: { x: 1, y: 0 } }));
  await new Promise(resolve => setTimeout(resolve, 10)); await vi.advanceTimersByTimeAsync(1100);
  ability(a.ws, w, 1, 'dash'); expect(await a.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'NO_DIRECTION' });
  for (let n = 2; n < 200; n++) ability(a.ws, w, n);
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'RATE_LIMITED' });
});

it('rejects unauthenticated, outsider and roomless ability access, and cleans ability state at match reset', async () => {
  const unauthenticated = await connect('member', true, false);
  ability(unauthenticated.ws, { sessionId: randomUUID() } as Welcome, 0);
  expect(await unauthenticated.next(m => m.type === 'error')).toMatchObject({ code: 'AUTH_REQUIRED' });
  const outsider = await connect('outsider'); expect(await outsider.next(m => m.type === 'error')).toMatchObject({ code: 'NOT_MEMBER' });
  const roomless = await connect('outsider', false); const rw = await roomless.next<Welcome>(m => m.type === 'welcome');
  ability(roomless.ws, rw, 0); expect(await roomless.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome'); ability(a.ws, aw, 0);
  await a.next<Snapshot>(m => m.type === 'snapshot' && !!m.gameplay?.abilityEvents?.length);
  active = false; await vi.advanceTimersByTimeAsync(1000);
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  const inactive = await connect(); expect(await inactive.next(m => m.type === 'error')).toMatchObject({ code: 'NOT_MEMBER' });
  active = true; matchId = randomUUID(); await vi.advanceTimersByTimeAsync(1000);
  const b = await connect(); await b.next(m => m.type === 'welcome');
  const reset = await b.next<Snapshot>(m => m.type === 'snapshot');
  expect(reset.gameplay!.abilities![0]).toMatchObject({ shieldUntilTick: 0, shieldReadyAtTick: 0, dashUntilTick: 0, dashReadyAtTick: 0 });
  expect(reset.gameplay!.abilityEvents).toHaveLength(0);
});

it.each(['position', 'cooldown', 'shieldUntilTick', 'dashSpeed', 'destination'])('rejects extra client ability field %s', async field => {
  const a = await connect(); const w = await a.next<Welcome>(m => m.type === 'welcome');
  a.ws.send(JSON.stringify({ type: 'ability', version: 1, sessionId: w.sessionId, sequence: 0, ability: 'shield', [field]: 99999 }));
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_MESSAGE' });
});
