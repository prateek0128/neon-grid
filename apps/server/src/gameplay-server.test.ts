import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { RoomArena, ServerMessage, Snapshot, Welcome } from '@neon/protocol';
import { RECONNECT_GRACE_MS } from '@neon/protocol';
import { createGameServer } from './server.ts';

const origin = 'http://localhost:5173';
const userA = randomUUID(); const userB = randomUUID();
const memberA = randomUUID(); const memberB = randomUUID(); const roomId = randomUUID();
let matchId: string;
let active: boolean;
let healthy: boolean;
let server: ReturnType<typeof createGameServer>;
let url: string;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  matchId = randomUUID(); active = true; healthy = true;
  server = createGameServer({ allowedOrigins: [origin],
    verifyToken: async token => ({ userId: token.startsWith('a') ? userA : token.startsWith('b') ? userB : randomUUID(), expiresAt: Date.now() + 60000 }),
    rooms: {
      tick: async () => {
        if (!healthy) throw new Error('Fixture authority unavailable');
        return active ? [{ roomId, matchId, startedAt: new Date().toISOString(), members: [{ id: memberA, userId: userA, slot: 1 }, { id: memberB, userId: userB, slot: 2 }] } satisfies RoomArena] : [];
      },
      authorize: async (token, requestedRoom, requestedMatch) => active && requestedRoom === roomId && requestedMatch === matchId ?
        token.startsWith('a') ? { id: memberA, slot: 1 } : token.startsWith('b') ? { id: memberB, slot: 2 } : null : null,
    },
  });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
});
afterEach(async () => { sockets.splice(0).forEach(ws => ws.terminate()); await server.close(); vi.restoreAllMocks(); });

async function connect(identity = 'a') {
  const ws = new WebSocket(url, { origin }); sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const next = async <T extends ServerMessage>(predicate: (m: ServerMessage) => boolean): Promise<T> => {
    for (let n = 0; n < 600; n++) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected gameplay message did not arrive');
  };
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: identity.repeat(40), roomId, matchId }));
  return { ws, next };
}

it('synchronizes collection, preserves scores on reconnect and clears state when the match ends', async () => {
  const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
  const b = await connect('b'); await b.next(m => m.type === 'welcome');
  const initial = await a.next<Snapshot>(m => m.type === 'snapshot' && m.players.length === 2);
  expect(initial.gameplay?.cores).toHaveLength(8);
  expect(initial.gameplay?.scores.every(s => s.score === 0)).toBe(true);
  // Reach the first deterministic core using only movement intent, never a position/collection command.
  let sequence = 0;
  const target = initial.gameplay!.cores[0]!.position;
  const start = initial.players.find(p => p.id === aw.playerId)!.position;
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const movement = { x: (target.x - start.x) / distance, y: (target.y - start.y) / distance };
  const timer = setInterval(() => a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: aw.sessionId, sequence: sequence++, movement })), 35);
  let collected: Snapshot;
  try { collected = await b.next<Snapshot>(m => m.type === 'snapshot' && !!m.gameplay?.scores.some(s => s.id === aw.playerId && s.score > 0)); }
  finally { clearInterval(timer); }
  a.ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: aw.sessionId, sequence: sequence++, movement: { x: 0, y: 0 } }));
  const same = await a.next<Snapshot>(m => m.type === 'snapshot' && m.tick === collected.tick);
  expect(same.gameplay).toEqual(collected.gameplay);
  expect(collected.gameplay!.scores.find(s => s.id === memberA)?.score).toBe(100);
  a.ws.close(); await once(a.ws, 'close');
  // Gameplay totals outlive the movement position map's disconnect grace.
  await new Promise(resolve => setTimeout(resolve, RECONNECT_GRACE_MS + 100));
  const expiredPosition = await b.next<Snapshot>(m => m.type === 'snapshot' && m.players.length === 1);
  expect(expiredPosition.gameplay!.scores.find(s => s.id === memberA)?.score).toBe(100);
  const reconnected = await connect();
  const welcome = await reconnected.next<Welcome>(m => m.type === 'welcome'); expect(welcome.playerId).toBe(memberA);
  const restored = await reconnected.next<Snapshot>(m => m.type === 'snapshot');
  expect(restored.gameplay!.scores.find(s => s.id === memberA)?.score).toBe(100);
  expect(restored.gameplay!.events).toHaveLength(1);
  const common = await b.next<Snapshot>(m => m.type === 'snapshot' && m.tick === restored.tick);
  expect(common.gameplay).toEqual(restored.gameplay);
  active = false;
  expect(await reconnected.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  expect(await b.next(m => m.type === 'error')).toMatchObject({ code: 'MATCH_UNAVAILABLE' });
  matchId = randomUUID(); active = true;
  await new Promise(resolve => setTimeout(resolve, 1100));
  const fresh = await connect(); await fresh.next(m => m.type === 'welcome');
  const reset = await fresh.next<Snapshot>(m => m.type === 'snapshot');
  expect(reset.epoch).toBe(matchId); expect(reset.gameplay!.scores.every(s => s.score === 0)).toBe(true);
  expect(reset.gameplay!.events).toHaveLength(0);
}, 30000);

it.each([
  { type: 'collect', version: 1, coreId: 'core-1', score: 999999 },
  { type: 'input', version: 1, position: { x: 20, y: 20 }, score: 999999 },
])('rejects client collection and score/position manipulation without rewards', async payload => {
  const a = await connect(); await a.next(m => m.type === 'welcome');
  a.ws.send(JSON.stringify(payload));
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_MESSAGE' });
  const b = await connect('b'); await b.next(m => m.type === 'welcome');
  const snapshot = await b.next<Snapshot>(m => m.type === 'snapshot');
  expect(snapshot.gameplay!.scores.every(s => s.score === 0)).toBe(true);
  expect(snapshot.gameplay!.events).toHaveLength(0);
});

it('rejects outsiders and closes gameplay sockets on room authority failure', async () => {
  const outsider = await connect('outsider');
  expect(await outsider.next(m => m.type === 'error')).toMatchObject({ code: 'NOT_MEMBER' });
  const a = await connect(); await a.next(m => m.type === 'welcome');
  healthy = false;
  expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'ROOM_UNAVAILABLE' });
});
