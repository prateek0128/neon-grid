import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage, Welcome, Snapshot } from '@neon/protocol';
import { createGameServer } from './legacy-websocket-server.ts';
import { createSupabaseVerifier } from './auth.ts';
import { createAuthFixture } from '../../../tests/auth-fixture.ts';

const origin = 'http://localhost:5173';
function inbox(ws: WebSocket) {
  const messages: ServerMessage[] = [];
  ws.on('message', raw => { messages.push(JSON.parse(raw.toString()) as ServerMessage); });
  return async <T extends ServerMessage>(predicate: (message: ServerMessage) => boolean): Promise<T> => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected protocol message did not arrive');
  };
}
describe('WebSocket authority through Supabase getUser', () => {
  let fixture: ReturnType<typeof createAuthFixture>;
  let server: ReturnType<typeof createGameServer>;
  let url: string;
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    fixture = createAuthFixture();
    fixture.http.listen(0, '127.0.0.1'); await once(fixture.http, 'listening');
    const authUrl = `http://127.0.0.1:${(fixture.http.address() as AddressInfo).port}`;
    server = createGameServer({ verifyToken: createSupabaseVerifier(authUrl, 'sb_publishable_test_fixture'), allowedOrigins: [origin], allowTestArena: true });
    server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
    url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach(ws => ws.terminate());
    await server.close();
    await new Promise<void>(resolve => fixture.http.close(() => resolve()));
  });
  async function connect(token = fixture.issue()) {
    const ws = new WebSocket(url, { origin }); sockets.push(ws);
    const next = inbox(ws);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: token }));
    return { ws, next, token };
  }
  function input(ws: WebSocket, welcome: Welcome, sequence: number, movement = { x: 1, y: 0 }) {
    ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: welcome.sessionId, sequence, movement }));
  }
  it('authenticates two distinct clients and synchronizes movement and release', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
    const b = await connect(); const bw = await b.next<Welcome>(m => m.type === 'welcome');
    expect(aw.playerId).not.toBe(bw.playerId); expect(aw.sessionId).not.toBe(bw.sessionId);
    input(a.ws, aw, 0);
    const moved = await b.next<Snapshot>(m => m.type === 'snapshot' && m.players.some(p => p.id === aw.playerId && p.position.x > 320));
    const sameTick = await a.next<Snapshot>(m => m.type === 'snapshot' && m.tick === moved.tick);
    expect(sameTick.players).toEqual(moved.players);
    input(a.ws, aw, 1, { x: 0, y: 0 });
    const stopped = await b.next<Snapshot>(m => m.type === 'snapshot' && m.players.some(p => p.id === aw.playerId && p.lastSequence === 1));
    const later = await b.next<Snapshot>(m => m.type === 'snapshot' && m.tick >= stopped.tick + 6);
    expect(later.players.find(p => p.id === aw.playerId)?.position).toEqual(stopped.players.find(p => p.id === aw.playerId)?.position);
  });
  it('rejects unverified and expired sessions', async () => {
    for (const token of ['not-a-valid-token'.repeat(3), fixture.issue(randomUUID(), -10)]) {
      const client = await connect(token);
      expect((await client.next(m => m.type === 'error')).type).toBe('error');
      if (client.ws.readyState !== WebSocket.CLOSED) await once(client.ws, 'close');
    }
  });
  it('requires authentication before movement', async () => {
    const ws = new WebSocket(url, { origin }); sockets.push(ws); const next = inbox(ws); await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'input', version: 1, sessionId: randomUUID(), sequence: 0, movement: { x: 1, y: 0 } }));
    expect(await next(m => m.type === 'error')).toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  it.each(['not json', JSON.stringify({ type: 'position', x: 900, y: 900 })])('rejects malformed messages', async raw => {
    const client = await connect(); await client.next(m => m.type === 'welcome'); client.ws.send(raw);
    expect(await client.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_MESSAGE' });
  });
  it('rejects another socket session ID', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
    const b = await connect(); const bw = await b.next<Welcome>(m => m.type === 'welcome');
    input(a.ws, bw, 0);
    expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_SESSION' });
    input(b.ws, bw, 0);
    expect((await b.next<Snapshot>(m => m.type === 'snapshot' && m.players.some(p => p.id === bw.playerId && p.lastSequence === 0))).players.some(p => p.id === aw.playerId)).toBe(true);
  });
  it('rejects repeated input sequence numbers', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
    input(a.ws, aw, 5); input(a.ws, aw, 5);
    expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'STALE_SEQUENCE' });
  });
  it('rejects excessive input rates', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
    for (let i = 0; i < 200; i++) input(a.ws, aw, i);
    expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('stops stale input without requiring a key-release packet', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome'); input(a.ws, aw, 0);
    const first = await a.next<Snapshot>(m => m.type === 'snapshot' && m.tick >= 12);
    const later = await a.next<Snapshot>(m => m.type === 'snapshot' && m.tick >= first.tick + 6);
    expect(later.players[0]?.position).toEqual(first.players[0]?.position);
  });
  it('preserves reconnect identity and does not corrupt the other player', async () => {
    const a = await connect(); const aw = await a.next<Welcome>(m => m.type === 'welcome');
    const b = await connect(); const bw = await b.next<Welcome>(m => m.type === 'welcome');
    a.ws.close(); await once(a.ws, 'close');
    const disconnected = await b.next<Snapshot>(m => m.type === 'snapshot' && m.players.some(p => p.id === aw.playerId && !p.connected));
    expect(disconnected.players.find(p => p.id === bw.playerId)?.connected).toBe(true);
    const reconnected = await connect(a.token); const rw = await reconnected.next<Welcome>(m => m.type === 'welcome');
    expect(rw.playerId).toBe(aw.playerId); expect(rw.sessionId).not.toBe(aw.sessionId);
    input(reconnected.ws, aw, 0);
    expect(await reconnected.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_SESSION' });
  });
  it('rejects duplicate active identity and fifth player', async () => {
    const first = await connect(); await first.next(m => m.type === 'welcome');
    const duplicate = await connect(first.token);
    expect(await duplicate.next(m => m.type === 'error')).toMatchObject({ code: 'SESSION_IN_USE' });
    for (let i = 0; i < 3; i++) { const client = await connect(); await client.next(m => m.type === 'welcome'); }
    const fifth = await connect(); expect(await fifth.next(m => m.type === 'error')).toMatchObject({ code: 'ARENA_FULL' });
  });
  it('renews a token only for the original identity', async () => {
    const id = randomUUID(); const a = await connect(fixture.issue(id)); await a.next(m => m.type === 'welcome');
    a.ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: fixture.issue(id, 7200) }));
    expect(await a.next(m => m.type === 'authenticated')).toMatchObject({ type: 'authenticated' });
    a.ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: fixture.issue() }));
    expect(await a.next(m => m.type === 'error')).toMatchObject({ code: 'INVALID_SESSION' });
  });
  it('rejects a forbidden browser origin', async () => {
    const ws = new WebSocket(url, { origin: 'https://outsider.example' }); sockets.push(ws);
    const [error] = await once(ws, 'error'); expect(String(error)).toContain('403');
  });
});
