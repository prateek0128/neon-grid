import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot, Welcome } from '@neon/protocol';
import { parseServerMessage } from '@neon/protocol';
import { createGameServer } from './server.ts';
const origin = 'https://neon-grid-tau.vercel.app';
let server: ReturnType<typeof createGameServer>, url: string, active: boolean;
let roomId: string, matchId: string;
let members: { id: string; userId: string; slot: number }[];
const tokens = ['fixture-member-a-token', 'fixture-member-b-token'];
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); const start = Date.now();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
  active = true; roomId = randomUUID(); matchId = randomUUID();
  members = [1, 2].map(slot => ({ id: randomUUID(), userId: randomUUID(), slot }));
  server = createGameServer({ allowedOrigins: [origin], matchDurationTicks: 2700,
    verifyToken: async token => {
      const index = tokens.indexOf(token); return index < 0 ? null : { userId: members[index]!.userId, expiresAt: Date.now() + 3600000 };
    }, rooms: {
      tick: async () => active ? [{ roomId, matchId, startedAt: new Date().toISOString(), members }] : [],
      authorize: async token => { const index = tokens.indexOf(token); return index < 0 || !active ? null : { id: members[index]!.id, slot: index + 1, host: index === 0, revision: 1 }; },
      returnLobby: async () => { active = false; return true; },
    },
  });
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  url = 'http://127.0.0.1:' + (server.http.address() as AddressInfo).port;
});
afterEach(async () => { await server.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function post(path: string, body: unknown, token = tokens[0]!, session?: string, requestedOrigin = origin) {
  const response = await fetch(url + '/game/' + path, { method: 'POST', headers: {
    Origin: requestedOrigin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
    ...(session ? { 'X-Game-Session': session } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as { messages: ServerMessage[]; error?: string } };
}
async function connect(index = 0, requestId = randomUUID()) {
  const reply = await post('connect', { requestId, roomId, matchId }, tokens[index]);
  expect(reply.status).toBe(200);
  const welcome = reply.body.messages.find(m => m.type === 'welcome') as Welcome;
  expect(welcome).toBeDefined();
  return { index, welcome, requestId, sequence: 0 };
}
async function step(client: Awaited<ReturnType<typeof connect>>, movement = { x: 0, y: 0 }, extra: Record<string, unknown>[] = []) {
  return post('step', { actions: [{ type: 'input', version: 1, sessionId: client.welcome.sessionId, sequence: client.sequence++, movement },
    ...extra.map(action => ({ version: 1, sessionId: client.welcome.sessionId, sequence: client.sequence++, ...action }))] }, tokens[client.index], client.welcome.sessionId);
}
function snapshot(reply: Awaited<ReturnType<typeof post>>) {
  const state = reply.body.messages.findLast(m => m.type === 'snapshot') as Snapshot;
  expect(state).toBeDefined(); expect(parseServerMessage(JSON.stringify(state))).not.toBeNull(); return state;
}
async function advance(milliseconds: number, clients: Awaited<ReturnType<typeof connect>>[]) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 200) {
    for (const client of clients) await step(client);
    await vi.advanceTimersByTimeAsync(Math.min(200, milliseconds - elapsed));
  }
}
it('authorizes identities and membership, rejects forged input, origins and oversized bodies', async () => {
  expect((await post('connect', { requestId: randomUUID(), roomId, matchId }, 'fixture-outsider-token')).body.messages).toContainEqual(expect.objectContaining({ type: 'error', code: 'INVALID_SESSION' }));
  expect((await post('connect', { requestId: randomUUID(), roomId: randomUUID(), matchId })).body.messages).toContainEqual(expect.objectContaining({ code: 'NOT_MEMBER' }));
  expect((await post('connect', { requestId: randomUUID(), roomId, matchId }, tokens[0], undefined, 'https://outsider.example.com')).status).toBe(403);
  const a = await connect();
  expect((await post('step', { actions: [] }, tokens[1], a.welcome.sessionId)).status).toBe(401);
  for (const forged of [{ position: { x: 900, y: 600 } }, { score: 999 }, { hazards: [] }, { damage: 0 }]) {
    expect((await post('step', { actions: [{ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence: 1, movement: { x: 0, y: 0 }, ...forged }] }, tokens[0], a.welcome.sessionId)).status).toBe(400);
  }
  expect((await post('step', { actions: [{ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence: 1, movement: { x: 2, y: 0 } }] }, tokens[0], a.welcome.sessionId)).status).toBe(400);
  expect((await post('step', { huge: 'x'.repeat(9000) }, tokens[0], a.welcome.sessionId)).status).toBe(413);
});
it('normalizes movement, synchronizes two clients, stops stale input and recovers the same identity', async () => {
  const a = await connect(), b = await connect(1);
  const before = snapshot(await step(a)).players.find(p => p.id === a.welcome.playerId)!;
  await step(a, { x: 1, y: 1 }); await vi.advanceTimersByTimeAsync(200);
  const moved = snapshot(await step(b)), own = moved.players.find(p => p.id === a.welcome.playerId)!;
  expect(Math.hypot(own.position.x - before.position.x, own.position.y - before.position.y)).toBeLessThanOrEqual(43);
  const states = await Promise.all([a, b].map(async client => {
    const response = await fetch(url + '/game/state', { headers: { Origin: origin, Authorization: 'Bearer ' + tokens[client.index], 'X-Game-Session': client.welcome.sessionId } });
    return (await response.json() as { messages: Snapshot[] }).messages.find(m => m.type === 'snapshot')!;
  }));
  expect(states[0]).toEqual(states[1]);
  await vi.advanceTimersByTimeAsync(500);
  const stopped = snapshot(await step(b)).players.find(p => p.id === a.welcome.playerId)!.position;
  await vi.advanceTimersByTimeAsync(500);
  expect(snapshot(await step(b)).players.find(p => p.id === a.welcome.playerId)!.position).toEqual(stopped);
  await post('disconnect', {}, tokens[0], a.welcome.sessionId);
  const restored = await connect(); expect(restored.welcome.playerId).toBe(a.welcome.playerId);
  expect(snapshot(await step(restored)).players.find(p => p.id === a.welcome.playerId)!.position).toEqual(stopped);
});
it('deduplicates concurrent connects and identical ability retries and rejects conflicting sequences', async () => {
  const requestId = randomUUID();
  const [a, duplicate] = await Promise.all([connect(0, requestId), connect(0, requestId)]);
  expect(duplicate.welcome.sessionId).toBe(a.welcome.sessionId);
  const action = { type: 'ability', version: 1, sessionId: a.welcome.sessionId, sequence: 0, ability: 'shield' };
  const first = snapshot(await post('step', { actions: [action] }, tokens[0], a.welcome.sessionId));
  const again = snapshot(await post('step', { actions: [action] }, tokens[0], a.welcome.sessionId));
  expect(again.gameplay!.abilities).toEqual(first.gameplay!.abilities);
  expect(again.gameplay!.abilityEvents).toHaveLength(1);
  expect((await post('step', { actions: [{ ...action, ability: 'dash' }] }, tokens[0], a.welcome.sessionId)).status).toBe(409);
});
it('preserves moving hazards, extraction, results, host-only replay and lobby reset over HTTP', async () => {
  const a = await connect(), b = await connect(1);
  await advance(32000, [a, b]);
  const first = snapshot(await step(a));
  expect(first.gameplay!.hazards![0]).toMatchObject({ pattern: 'horizontal-up', phase: 'active' });
  expect(snapshot(await step(b)).gameplay).toEqual(first.gameplay);
  await advance(39000, [a, b]);
  const extraction = snapshot(await step(a)); expect(extraction.gameplay!.extraction!.phase).toBe('open');
  expect(extraction.gameplay!.difficultyStage).toBe(3);
  await advance(20000, [a, b]);
  const final = snapshot(await step(a)); expect(final.gameplay!.match!.phase).toBe('RESULTS'); expect(final.gameplay!.extraction!.phase).toBe('lockdown');
  const denied = await step(b, undefined, [{ type: 'lifecycle', action: 'replay', matchId: final.epoch }]);
  expect(denied.body.messages).toContainEqual(expect.objectContaining({ type: 'lifecycle_rejected', reason: 'HOST_ONLY' }));
  await step(a, undefined, [{ type: 'lifecycle', action: 'replay', matchId: final.epoch }]);
  const replay = await connect(), replayB = await connect(1);
  const fresh = snapshot(await step(replay)); expect(fresh.epoch).not.toBe(final.epoch);
  expect(fresh.gameplay!.difficultyStage).toBe(1); expect(fresh.gameplay!.scores.every(s => s.score === 0)).toBe(true);
  await step(replay, undefined, [{ type: 'lifecycle', action: 'return', matchId: fresh.epoch }]);
  expect(active).toBe(false);
  expect((await step(replayB)).status).toBe(401);
}, 30000);
it('expires inactive sessions without affecting the remaining player and bounds request rates', async () => {
  const a = await connect(), b = await connect(1);
  for (let elapsed = 0; elapsed < 4000; elapsed += 200) { await step(b); await vi.advanceTimersByTimeAsync(200); }
  expect((await step(a)).status).toBe(401);
  expect(snapshot(await step(b)).players.find(p => p.id === b.welcome.playerId)!.connected).toBe(true);
  const responses = [];
  for (let n = 0; n < 125; n++) responses.push(await post('step', { actions: [] }, tokens[1], b.welcome.sessionId));
  expect(responses.some(r => r.status === 429)).toBe(true);
  const recoveredA = await connect(); expect((await step(recoveredA)).status).toBe(200);
});

it('resumes a live shield and acknowledged sequence immediately without recreating the player', async () => {
  const a = await connect();
  const active = snapshot(await step(a, undefined, [{ type: 'ability', ability: 'shield' }]));
  const resumed = await post('resume', {}, tokens[0], a.welcome.sessionId);
  expect(resumed.body.messages).toContainEqual(expect.objectContaining({ type: 'welcome', playerId: a.welcome.playerId, sessionId: a.welcome.sessionId }));
  expect(snapshot(resumed).gameplay!.abilities).toEqual(active.gameplay!.abilities);
  expect(snapshot(resumed).players.find(p => p.id === a.welcome.playerId)!.lastSequence).toBe(a.sequence - 1);
  expect(snapshot(await step(a)).gameplay!.abilityEvents).toHaveLength(1);
});
it('rejects an unseen late input without disconnecting or overwriting newer movement', async () => {
  const a = await connect();
  const envelope = (sequence: number, x: number) => ({ type: 'input', version: 1, sessionId: a.welcome.sessionId, sequence, movement: { x, y: 0 } });
  expect((await post('step', { actions: [envelope(2, 1)] }, tokens[0], a.welcome.sessionId)).status).toBe(200);
  const late = await post('step', { actions: [envelope(1, -1)] }, tokens[0], a.welcome.sessionId);
  expect(late.status).toBe(409);
  const state = await post('step', { actions: [] }, tokens[0], a.welcome.sessionId);
  expect(state.status).toBe(200);
  expect(late.body.error).toBe('STALE_SEQUENCE');
  expect(snapshot(state).players.find(p => p.id === a.welcome.playerId)).toMatchObject({ connected: true, lastSequence: 2 });
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshot(await post('step', { actions: [] }, tokens[0], a.welcome.sessionId)).players.find(p => p.id === a.welcome.playerId)!.position.x).toBeGreaterThan(320);
});
