import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../../tests/database.ts';
import { createAuthFixture } from '../../../tests/auth-fixture.ts';
import { createGameServer } from './server.ts';
import { createSupabaseRooms } from './rooms.ts';
import { createSupabaseVerifier } from './auth.ts';
import type { RoomSnapshot } from '@neon/protocol';
it('fences competing HTTP authorities and aborts old matches on natural-expiry takeover', async () => {
  const data = await createTestDatabase(), fixture = createAuthFixture(data);
  fixture.http.listen(0, '127.0.0.1'); await once(fixture.http, 'listening');
  const authUrl = 'http://127.0.0.1:' + (fixture.http.address() as AddressInfo).port;
  const origin = 'https://neon-grid-tau.vercel.app';
  const options = { allowedOrigins: [origin], verifyToken: createSupabaseVerifier(authUrl, 'sb_publishable_test_fixture'),
    rooms: createSupabaseRooms(authUrl, 'sb_publishable_test_fixture', 'sb_secret_test_fixture') };
  const first = createGameServer(options); let replacement: ReturnType<typeof createGameServer> | undefined;
  async function listen(server: ReturnType<typeof createGameServer>) {
    server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
    return 'http://127.0.0.1:' + (server.http.address() as AddressInfo).port;
  }
  try {
    const firstUrl = await listen(first);
    await vi.waitFor(async () => expect((await fetch(firstUrl + '/ready')).status).toBe(200), { timeout: 4000 });
    const a = await data.user(), b = await data.user();
    async function rpc(user: string, name: string, args: Record<string, unknown>): Promise<RoomSnapshot> {
      const result = await data.rpc(user, name, args);
      if (!result.ok || !('room' in result)) throw Error('Fixture room RPC failed');
      return result.room;
    }
    let room = await rpc(a, 'ng_create_room', { p_request_id: randomUUID(), p_name: 'Cipher' });
    room = await rpc(b, 'ng_join_room', { p_request_id: randomUUID(), p_name: 'Ghost', p_code: room.code });
    room = await rpc(a, 'ng_set_ready', { p_request_id: randomUUID(), p_room_id: room.id, p_ready: true, p_revision: room.revision });
    room = await rpc(b, 'ng_set_ready', { p_request_id: randomUUID(), p_room_id: room.id, p_ready: true, p_revision: room.revision });
    await rpc(a, 'ng_request_start', { p_request_id: randomUUID(), p_room_id: room.id, p_revision: room.revision });
    await vi.waitFor(async () => { room = await rpc(a, 'ng_get_room', { p_room_id: room.id }); expect(room.status).toBe('IN_MATCH'); }, { timeout: 4000 });
    const oldMatch = room.match!.id, token = fixture.issue(a);
    const diagnostic = vi.fn();
    replacement = createGameServer({ ...options, diagnostic });
    const nextUrl = await listen(replacement);
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledWith({ event: 'authority_unavailable', reason: 'lease_busy' }));
    const connect = (base: string) => fetch(base + '/game/connect', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), roomId: room.id, matchId: oldMatch }) });
    expect((await connect(nextUrl)).status).toBe(503);
    expect((await connect(firstUrl)).status).toBe(200);
    await first.close();
    // Test database only: advancing the lease expiry avoids a ten-second wall-clock wait.
    await data.db.exec("update ng_private.runtime set lease_until=now()-interval '1 second'");
    await vi.waitFor(async () => expect((await fetch(nextUrl + '/ready')).status).toBe(200), { timeout: 4000 });
    expect((await rpc(a, 'ng_get_room', { p_room_id: room.id })).status).toBe('LOBBY');
    expect((await connect(nextUrl)).status).toBe(403);
  } finally {
    await first.close(); await replacement?.close();
    await new Promise<void>(resolve => fixture.http.close(() => resolve())); await data.db.close();
  }
});
