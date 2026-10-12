import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer } from './legacy-websocket-server.ts';
import { RoomAuthorityError } from './rooms.ts';
const origin = 'https://web.example.com';
async function listen(server: ReturnType<typeof createGameServer>) {
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  return `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
}
it('separates liveness, readiness and safe HTTP methods without revealing configuration', async () => {
  let complete!: (states: []) => void;
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null,
    rooms: { authorize: async () => null, tick: () => new Promise(resolve => { complete = resolve; }) } });
  const url = await listen(server);
  try {
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const notReady = await fetch(`${url}/ready`); expect(notReady.status).toBe(503); expect(await notReady.json()).toEqual({ status: 'not_ready', protocol: 1 });
    const unavailable = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin });
    const [error] = await once(unavailable, 'error'); expect(String(error)).toContain('503');
    complete([]); await vi.waitFor(async () => expect((await fetch(`${url}/ready`)).status).toBe(200));
    const ready = await fetch(`${url}/ready`); expect(ready.headers.get('cache-control')).toBe('no-store'); expect(await ready.json()).toEqual({ status: 'ready', protocol: 1 });
    expect((await fetch(`${url}/health`, { method: 'HEAD' })).status).toBe(200);
    const post = await fetch(`${url}/health`, { method: 'POST' }); expect(post.status).toBe(405); expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect((await fetch(`${url}/unknown`)).status).toBe(404);
  } finally { await server.close(); }
});
it('drops readiness and closes sockets when required room authority fails', async () => {
  let fail = false;
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, rooms: { authorize: async () => null, tick: async () => { if (fail) throw new Error('private internal detail'); return []; } } });
  const url = await listen(server);
  try {
    await vi.waitFor(async () => expect((await fetch(`${url}/ready`)).status).toBe(200)); fail = true;
    await vi.waitFor(async () => expect((await fetch(`${url}/ready`)).status).toBe(503), { timeout: 2000 });
    expect(await (await fetch(`${url}/ready`)).text()).not.toContain('private'); expect((await fetch(`${url}/health`)).status).toBe(200);
  } finally { await server.close(); }
});
it('bounds graceful shutdown, sends restart notice and closes idempotently', async () => {
  const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => ({ userId: randomUUID(), expiresAt: Date.now() + 60000 }) });
  const url = await listen(server); const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin });
  await once(ws, 'open'); const message = once(ws, 'message'); const closed = once(ws, 'close');
  const first = server.close(); const second = server.close(); expect(first).toBe(second);
  expect(JSON.parse(String((await message)[0]))).toMatchObject({ type: 'error', code: 'SERVER_CLOSING' });
  expect((await closed)[0]).toBe(1012); await first; expect(server.http.listening).toBe(false);
});
it('forces a lingering HTTP connection closed at the shutdown deadline', async () => {
  const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => null, shutdownGraceMs: 50 });
  await listen(server);
  const peer = connect((server.http.address() as AddressInfo).port, '127.0.0.1');
  await once(peer, 'connect'); peer.write('POST /health HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\nx');
  peer.resume(); await new Promise(resolve => setTimeout(resolve, 10));
  const closed = once(peer, 'close'); const start = performance.now();
  try { await server.close(); await closed; expect(performance.now() - start).toBeLessThan(1000); }
  finally { peer.destroy(); await server.close(); }
});
it.each(['', 'https://outsider.example.com', 'null'])('denies missing or forbidden origin before identity verification', async badOrigin => {
  const verifyToken = vi.fn(); const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken });
  const url = await listen(server);
  try {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', badOrigin ? { origin: badOrigin } : {});
    const [error] = await once(ws, 'error'); expect(String(error)).toContain('403'); expect(verifyToken).not.toHaveBeenCalled();
  } finally { await server.close(); }
});
it('rejects oversized and binary messages and remains available to a fresh client', async () => {
  const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => null }); const url = await listen(server);
  try {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin }); await once(ws, 'open'); const closed = once(ws, 'close'); ws.send('x'.repeat(8193)); expect((await closed)[0]).toBe(1009);
    const binary = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin }); await once(binary, 'open'); const received = once(binary, 'message'); const stopped = once(binary, 'close'); binary.send(Buffer.from('invalid'));
    expect(JSON.parse(String((await received)[0]))).toMatchObject({ code: 'INVALID_MESSAGE' }); await stopped;
    expect((await fetch(`${url}/ready`)).status).toBe(200);
  } finally { await server.close(); }
});
it('removes a peer that stops answering heartbeat pings', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => ({ userId: randomUUID(), expiresAt: Date.now() + 60000 }) });
  const url = await listen(server); const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin, autoPong: false });
  try {
    await once(ws, 'open'); const welcomed = once(ws, 'message'); ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 'fixture-test-token'.repeat(3) })); await welcomed;
    const closed = once(ws, 'close'); await vi.advanceTimersByTimeAsync(20001); await closed;
    expect((await fetch(`${url}/health`)).status).toBe(200);
  } finally { ws.terminate(); await server.close(); vi.useRealTimers(); }
});
it('accepts exactly /ws with the production Origin and records 101 without granting authentication', async () => {
  const diagnostic = vi.fn(); const verifyToken = vi.fn(async () => null);
  const server = createGameServer({ allowedOrigins: ['https://neon-grid-tau.vercel.app'], allowTestArena: true, verifyToken, diagnostic });
  const url = await listen(server); const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: 'https://neon-grid-tau.vercel.app' });
  try {
    const upgrade = once(ws, 'upgrade'); await once(ws, 'open');
    expect((await upgrade)[0].statusCode).toBe(101); expect(verifyToken).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_received', path: 'ws', originAllowed: true });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_accepted', status: 101 });
    const closed = once(ws, 'close'); ws.close(1000); await closed;
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledWith({ event: 'socket_closed', code: 1000, authenticated: false }));
  } finally { ws.terminate(); await server.close(); }
});
it.each(['/ws/', '/api/ws', '/ws?access_token=private-test-sentinel'])('rejects invalid upgrade path %s without logging raw request data', async path => {
  const diagnostic = vi.fn(); const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => null, diagnostic });
  const url = await listen(server);
  try {
    const ws = new WebSocket(url.replace('http:', 'ws:') + path, { origin });
    const [error] = await once(ws, 'error'); expect(String(error)).toContain('403');
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'path', status: 403 });
    expect(JSON.stringify(diagnostic.mock.calls).includes('private-test-sentinel')).toBe(false);
  } finally { await server.close(); }
});
it('distinguishes a forbidden production Origin from an unavailable authority', async () => {
  const diagnostic = vi.fn(); const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: async () => { throw Error('private-dependency-detail'); } } });
  const url = await listen(server);
  try {
    for (const requestedOrigin of ['https://neon-grid-tau.vercel.app', origin]) {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: requestedOrigin }); await once(ws, 'error');
    }
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'origin', status: 403 });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'not_ready', status: 503 });
    expect(JSON.stringify(diagnostic.mock.calls).includes('private-dependency-detail')).toBe(false);
  } finally { await server.close(); }
});
it('records a malformed handshake safely and leaves the server available', async () => {
  const diagnostic = vi.fn(); const server = createGameServer({ allowedOrigins: [origin], allowTestArena: true, verifyToken: async () => null, diagnostic });
  const url = await listen(server);
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url + '/ws', { headers: { Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'private-test-sentinel' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(400); expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'handshake', status: 400 });
    expect(JSON.stringify(diagnostic.mock.calls).includes('private-test-sentinel')).toBe(false);
    expect((await fetch(url + '/ready')).status).toBe(200);
  } finally { await server.close(); }
});
it('reports a busy lease as unhealthy authority and recovers without bypassing readiness', async () => {
  let busy = true; const diagnostic = vi.fn();
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: async () => { if (busy) throw new RoomAuthorityError('lease_busy'); return []; } } });
  const url = await listen(server);
  try {
    expect((await fetch(url + '/ready')).status).toBe(503);
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_unhealthy', syncInFlight: false, authorityFailure: 'lease_busy' });
    busy = false;
    await vi.waitFor(async () => expect((await fetch(url + '/ready')).status).toBe(200), { timeout: 2000 });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'ready', syncInFlight: false });
  } finally { await server.close(); }
});
it('reports stale authority while a renewal hangs and keeps public readiness details private', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let clock = 0; const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  let pending = false; const diagnostic = vi.fn();
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: async () => pending ? new Promise(() => {}) : [] } });
  const url = await listen(server);
  try {
    expect((await fetch(url + '/ready')).status).toBe(200);
    pending = true; clock = 1000; await vi.advanceTimersByTimeAsync(1000);
    clock = 5001; await vi.advanceTimersByTimeAsync(1000);
    const response = await fetch(url + '/ready'); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready', protocol: 1 });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_stale', syncInFlight: true });
  } finally { await server.close(); now.mockRestore(); vi.useRealTimers(); }
});

it.each(['rpc_permission', 'rpc_failure', 'invalid_response'] as const)('reports %s as failed reconciliation without exposing dependency details', async reason => {
  const diagnostic = vi.fn();
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: async () => { throw new RoomAuthorityError(reason); } } });
  const url = await listen(server);
  try {
    expect((await fetch(url + '/ready')).status).toBe(503);
    expect(diagnostic).toHaveBeenCalledWith({ event: 'authority_unavailable', reason });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_unhealthy', syncInFlight: false, authorityFailure: reason });
    expect(diagnostic).not.toHaveBeenCalledWith({ event: 'authority_recovered' });
  } finally { await server.close(); }
});
it('preserves pending and failed readiness diagnostics after connection log exhaustion', async () => {
  const diagnostic = vi.fn(); let fail!: (error: Error) => void;
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: () => new Promise((_resolve, reject) => { fail = reject; }) } });
  const url = await listen(server);
  try {
    for (let i = 0; i < 61; i++) {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/invalid?private-test-sentinel', { origin });
      await once(ws, 'error');
    }
    expect(diagnostic).toHaveBeenCalledWith({ event: 'diagnostics_limited', scope: 'connections' });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'diagnostics_limited', scope: 'admission' });
    expect(diagnostic.mock.calls.filter(([event]) => event.event === 'upgrade_rejected')).toHaveLength(60);
    expect((await fetch(url + '/ready')).status).toBe(503);
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_pending', syncInFlight: true });
    fail(new RoomAuthorityError('lease_busy'));
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledWith({ event: 'authority_unavailable', reason: 'lease_busy' }));
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_unhealthy', syncInFlight: false, authorityFailure: 'lease_busy' });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-test-sentinel');
  } finally { await server.close(); }
});
it('does not report recovery if arena processing fails after a successful RPC', async () => {
  const diagnostic = vi.fn();
  const server = createGameServer({ allowedOrigins: [origin], verifyToken: async () => null, diagnostic,
    rooms: { authorize: async () => null, tick: async () => [{ roomId: randomUUID(), matchId: randomUUID(), members: null } as unknown as import('@neon/protocol').RoomArena] } });
  const url = await listen(server);
  try {
    expect((await fetch(url + '/ready')).status).toBe(503);
    expect(diagnostic).toHaveBeenCalledWith({ event: 'readiness', condition: 'authority_unhealthy', syncInFlight: false, authorityFailure: 'unknown' });
    expect(diagnostic).not.toHaveBeenCalledWith({ event: 'authority_recovered' });
  } finally { await server.close(); }
});
it('rejects the production-origin handshake before auth during lease contention, then sends the initial match snapshot after recovery', async () => {
  const productionOrigin = 'https://neon-grid-tau.vercel.app';
  const roomId = randomUUID(), matchId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  let busy = true;
  const release = () => { busy = false; };
  const verifyToken = vi.fn(async () => ({ userId, expiresAt: Date.now() + 60000 }));
  const authorize = vi.fn(async () => ({ id: memberId, slot: 1 }));
  const diagnostic = vi.fn();
  const server = createGameServer({ allowedOrigins: [productionOrigin], verifyToken, diagnostic,
    rooms: { authorize, tick: async () => {
      if (busy) throw new RoomAuthorityError('lease_busy');
      return [{ roomId, matchId, startedAt: new Date().toISOString(), members: [{ id: memberId, userId, slot: 1 }] }];
    } } });
  const url = await listen(server);
  let connected: WebSocket | undefined;
  try {
    const rejected = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: productionOrigin });
    const [error] = await once(rejected, 'error');
    expect(String(error)).toContain('503');
    expect(verifyToken).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({ event: 'authority_unavailable', reason: 'lease_busy' });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'not_ready', status: 503 });
    expect((await fetch(url + '/health')).status).toBe(200);
    expect((await fetch(url + '/ready')).status).toBe(503);
    release();
    await vi.waitFor(async () => expect((await fetch(url + '/ready')).status).toBe(200), { timeout: 3000 });
    connected = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: productionOrigin });
    const received: unknown[] = [];
    connected.on('message', raw => received.push(JSON.parse(raw.toString())));
    await once(connected, 'open');
    connected.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 'fixture-only-valid-token', roomId, matchId }));
    await vi.waitFor(() => expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'welcome', playerId: memberId }),
      expect.objectContaining({ type: 'snapshot', gameplay: expect.objectContaining({ match: expect.objectContaining({ id: matchId }), hazards: expect.any(Array) }) }),
    ])));
    expect(verifyToken).toHaveBeenCalledTimes(1); expect(authorize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('fixture-only-valid-token');
  } finally { release(); connected?.terminate(); await server.close(); }
});
it('identifies capacity 403 before authentication and admits a new socket after a slot is released', async () => {
  const diagnostic = vi.fn(), verifyToken = vi.fn(async () => null);
  const productionOrigin = 'https://neon-grid-tau.vercel.app';
  const server = createGameServer({ allowedOrigins: [productionOrigin], allowTestArena: true, verifyToken, diagnostic });
  const url = await listen(server); const sockets: WebSocket[] = [];
  try {
    for (let n = 0; n < 32; n++) {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: productionOrigin });
      sockets.push(ws); await once(ws, 'open');
    }
    const rejected = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: productionOrigin });
    const [error] = await once(rejected, 'error'); expect(String(error)).toContain('403');
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_rejected', reason: 'capacity', status: 403 });
    expect(verifyToken).not.toHaveBeenCalled();
    const closed = once(sockets[0]!, 'close'); sockets[0]!.close(); await closed;
    const admitted = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin: productionOrigin });
    sockets.push(admitted); await once(admitted, 'open');
  } finally { sockets.forEach(ws => ws.terminate()); await server.close(); }
});
it.each(['INVALID_SESSION', 'NOT_MEMBER'] as const)('reports %s after upgrade, never as an HTTP 403', async code => {
  const diagnostic = vi.fn(); const roomId = randomUUID(), matchId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  const server = createGameServer({ allowedOrigins: [origin], diagnostic,
    verifyToken: async () => code === 'INVALID_SESSION' ? null : ({ userId, expiresAt: Date.now() + 60000 }),
    rooms: { authorize: async () => null, tick: async () => [{ roomId, matchId, startedAt: new Date().toISOString(), members: [{ id: memberId, userId, slot: 1 }] }] } });
  const url = await listen(server); let ws: WebSocket | undefined;
  try {
    await vi.waitFor(async () => expect((await fetch(url + '/ready')).status).toBe(200));
    ws = new WebSocket(url.replace('http:', 'ws:') + '/ws', { origin }); await once(ws, 'open');
    const received = once(ws, 'message'), closed = once(ws, 'close');
    ws.send(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 'fixture-only-invalid-session', roomId, matchId }));
    expect(JSON.parse(String((await received)[0]))).toMatchObject({ type: 'error', code });
    expect((await closed)[0]).toBe(1008);
    expect(diagnostic).toHaveBeenCalledWith({ event: 'upgrade_accepted', status: 101 });
    expect(diagnostic).toHaveBeenCalledWith({ event: 'message_rejected', code });
    expect(diagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'upgrade_rejected' }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('fixture-only-invalid-session');
  } finally { ws?.terminate(); await server.close(); }
});
