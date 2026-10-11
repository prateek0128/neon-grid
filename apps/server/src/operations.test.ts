import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect, type AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer } from './server.ts';
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
