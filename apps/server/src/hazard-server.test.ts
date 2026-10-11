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

it('broadcasts damage, reconnect recovery, death, respawn and match reset', async () => {
  const a = await connect(); await a.next<Welcome>(m => m.type === 'welcome');
  await vi.advanceTimersByTimeAsync(7600);
  const injured = await a.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.vitals?.[0]?.health === 50);
  expect(injured.gameplay!.hazards![0]!.phase).toBe('active');
  a.ws.close(); await once(a.ws, 'close');
  const b = await connect(); const bw = await b.next<Welcome>(m => m.type === 'welcome');
  const restored = await b.next<Snapshot>(m => m.type === 'snapshot');
  expect(restored.gameplay!.vitals![0]!.health).toBe(50);
  expect(restored.gameplay!.healthEvents).toEqual(injured.gameplay!.healthEvents);
  b.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: bw.sessionId, sequence: 0, movement: { x: 1, y: 0 } }));
  await new Promise(resolve => setTimeout(resolve, 10));
  for (let n = 0; n < 46; n++) {
    b.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: bw.sessionId, sequence: n + 1, movement: { x: 1, y: 0 } }));
    await new Promise(resolve => setTimeout(resolve, 2)); await vi.advanceTimersByTimeAsync(34);
  }
  b.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: bw.sessionId, sequence: 47, movement: { x: 0, y: 0 } }));
  await new Promise(resolve => setTimeout(resolve, 10)); await vi.advanceTimersByTimeAsync(2500);
  const dead = await b.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay?.vitals?.[0]?.life === 'respawning');
  const position = dead.players[0]!.position;
  ability(b.ws, bw, 48); expect(await b.next(m => m.type === 'ability_rejected')).toMatchObject({ reason: 'DEAD' });
  b.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: bw.sessionId, sequence: 49, movement: { x: -1, y: 0 } }));
  await new Promise(resolve => setTimeout(resolve, 10)); await vi.advanceTimersByTimeAsync(1000);
  const frozen = await b.next<Snapshot>(m => m.type === 'snapshot' && m.gameplay!.tick > dead.gameplay!.tick + 20);
  expect(frozen.players[0]!.position).toEqual(position);
  await vi.advanceTimersByTimeAsync(2100);
  const respawn = await b.next<Snapshot>(m => m.type === 'snapshot' && !!m.gameplay?.healthEvents?.some(e => e.kind === 'respawn'));
  expect(respawn.gameplay!.vitals![0]).toMatchObject({ health: 100, life: 'alive' });
  expect(respawn.gameplay!.vitals![0]!.invulnerableUntilTick).toBeGreaterThan(respawn.gameplay!.tick);
  active = false; await vi.advanceTimersByTimeAsync(1000);
  expect(await b.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  active = true; matchId = randomUUID(); await vi.advanceTimersByTimeAsync(1000);
  const c = await connect(); await c.next(m => m.type === 'welcome');
  const fresh = await c.next<Snapshot>(m => m.type === 'snapshot');
  expect(fresh.gameplay!.vitals![0]).toMatchObject({ health: 100, life: 'alive' });
  expect(fresh.gameplay!.healthEvents).toHaveLength(0);
});

it.each(['health', 'damage', 'life', 'respawnPosition', 'collision'])('rejects forged lifecycle field %s at the socket boundary', async field => {
  const a = await connect(); const w = await a.next<Welcome>(m => m.type === 'welcome');
  a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: w.sessionId, sequence: 0, movement: { x: 0, y: 0 }, [field]: 999 }));
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_MESSAGE' });
});
