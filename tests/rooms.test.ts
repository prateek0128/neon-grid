import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from './database.ts';
import type { RoomResult, RoomSnapshot } from '../packages/protocol/src/rooms.ts';

function room(result: RoomResult): RoomSnapshot {
  if (!result.ok || !('room' in result)) throw new Error(JSON.stringify(result)); return result.room;
}
describe('migration RPCs and RLS on embedded PostgreSQL (not live Supabase)', () => {
  let data: Awaited<ReturnType<typeof createTestDatabase>>;
  let host: string; let guest: string; let initial: RoomSnapshot;
  beforeEach(async () => {
    data = await createTestDatabase(); host = await data.user(); guest = await data.user();
    initial = room(await data.rpc(host, 'ng_create_room', { p_request_id: randomUUID(), p_name: 'Cipher' }));
  }, 45000);
  afterEach(async () => { await data.db.close(); });
  async function join(id = guest, requestId = randomUUID(), code = initial.code) {
    return data.rpc(id, 'ng_join_room', { p_request_id: requestId, p_name: 'Ghost', p_code: code });
  }
  async function snapshot(id = host) { return room(await data.rpc(id, 'ng_get_room', { p_room_id: initial.id })); }
  async function ready(id: string, value = true) {
    const current = await snapshot(id);
    return data.rpc(id, 'ng_set_ready', { p_request_id: randomUUID(), p_room_id: initial.id, p_ready: value, p_revision: current.revision });
  }
  async function start(id = host, requestId = randomUUID(), revision?: number) {
    return data.rpc(id, 'ng_request_start', { p_request_id: requestId, p_room_id: initial.id, p_revision: revision ?? (await snapshot(id)).revision });
  }
  it('creates a private room with a random code and host identity', () => {
    expect(initial.code).toMatch(/^[A-F0-9]{12}$/); expect(initial.members).toHaveLength(1);
    expect(initial.hostMemberId).toBe(initial.selfMemberId); expect(initial.status).toBe('LOBBY');
  });
  it('deduplicates create requests and rejects changed parameters', async () => {
    const id = await data.user(); const request = randomUUID();
    const a = room(await data.rpc(id, 'ng_create_room', { p_request_id: request, p_name: 'A' }));
    const b = room(await data.rpc(id, 'ng_create_room', { p_request_id: request, p_name: 'A' })); expect(a.id).toBe(b.id);
    expect(await data.rpc(id, 'ng_create_room', { p_request_id: request, p_name: 'B' })).toMatchObject({ code: 'REQUEST_CONFLICT' });
  });
  it('validates codes, handles missing rooms and accepts lowercase codes', async () => {
    expect(await join(guest, randomUUID(), 'bad')).toMatchObject({ code: 'INVALID_CODE' });
    expect(await join(guest, randomUUID(), 'FFFFFFFFFFFF')).toMatchObject({ code: 'ROOM_MISSING' });
    expect(room(await join(guest, randomUUID(), initial.code.toLowerCase())).members).toHaveLength(2);
  });
  it('enforces four-player capacity for competing final-slot requests', async () => {
    await join(); await join(await data.user());
    const a = await data.user(); const b = await data.user();
    const results = await Promise.all([join(a), join(b)]);
    expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok)).toMatchObject({ code: 'ROOM_FULL' });
    expect((await snapshot()).members).toHaveLength(4);
  });
  it('deduplicates joins without duplicate memberships', async () => {
    const request = randomUUID(); const a = room(await join(guest, request)); const b = room(await join(guest, request));
    expect(a.selfMemberId).toBe(b.selfMemberId); expect(b.members).toHaveLength(2);
    expect(room(await join()).members).toHaveLength(2);
  });
  it('supports ready/unready and detects stale revisions', async () => {
    await join(); expect(room(await ready(host)).members.find(m => m.id === initial.selfMemberId)?.ready).toBe(true);
    expect(room(await ready(host, false)).members.find(m => m.id === initial.selfMemberId)?.ready).toBe(false);
    expect(await data.rpc(host, 'ng_set_ready', { p_request_id: randomUUID(), p_room_id: initial.id, p_ready: true, p_revision: 1 })).toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('requires host authority, two players and everyone ready', async () => {
    expect(await start()).toMatchObject({ code: 'NOT_READY' }); await join();
    expect(await start(guest)).toMatchObject({ code: 'HOST_ONLY' }); await ready(host);
    expect(await start()).toMatchObject({ code: 'NOT_READY' }); await ready(guest);
    expect(room(await start()).status).toBe('STARTING');
  });
  it('deduplicates start and independently activates with authoritative timestamp', async () => {
    await join(); await ready(host); await ready(guest); const revision = (await snapshot()).revision; const request = randomUUID();
    const a = room(await start(host, request, revision)); const b = room(await start(host, request, revision));
    expect(a.match?.id).toBe(b.match?.id);
    expect(await start(host, randomUUID(), revision)).toMatchObject({ code: 'REVISION_CONFLICT' });
    await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role');
    const active = await snapshot(); expect(active.status).toBe('IN_MATCH'); expect(active.match?.startedAt).toBeTruthy();
    expect(room(await join()).id).toBe(initial.id);
    expect(await join(await data.user())).toMatchObject({ code: 'ALREADY_STARTED' });
  });
  it('denies nonmembers, browser direct writes, operational RPCs and private tables', async () => {
    expect(await data.rpc(guest, 'ng_get_room', { p_room_id: initial.id })).toMatchObject({ code: 'NOT_MEMBER' });
    expect(await data.asRole('authenticated', guest, 'select * from public.ng_rooms')).toHaveLength(0);
    expect(await data.asRole('authenticated', host, 'select * from public.ng_rooms')).toHaveLength(1);
    await expect(data.asRole('authenticated', host, "update public.ng_rooms set status='IN_MATCH'")).rejects.toThrow(/permission denied/);
    await expect(data.asRole('authenticated', host, 'insert into public.ng_room_members(room_id,user_id,slot,display_name) values($1,$2,2,$3)', [initial.id,guest,'Fake'])).rejects.toThrow(/permission denied/);
    await expect(data.rpc(host, 'ng_server_tick', { p_instance_id: randomUUID() })).rejects.toThrow(/permission denied/);
    await expect(data.asRole('authenticated', host, 'select * from ng_private.codes')).rejects.toThrow(/permission denied/);
    await expect(data.rpc(null, 'ng_create_room', { p_request_id: randomUUID(), p_name: 'Anon' }, 'anon')).rejects.toThrow(/permission denied/);
  });
  it('transfers departing host deterministically and deletes the empty room', async () => {
    const joined = room(await join());
    await data.rpc(host, 'ng_leave_room', { p_request_id: randomUUID(), p_room_id: initial.id });
    expect((await snapshot(guest)).hostMemberId).toBe(joined.selfMemberId);
    expect(await data.rpc(host, 'ng_get_room', { p_room_id: initial.id })).toMatchObject({ code: 'NOT_MEMBER' });
    await data.rpc(guest, 'ng_leave_room', { p_request_id: randomUUID(), p_room_id: initial.id });
    expect(await data.rpc(guest, 'ng_get_room', { p_room_id: initial.id })).toMatchObject({ code: 'ROOM_MISSING' });
  });
  it('rejects changed rosters during STARTING', async () => {
    await join(); await ready(host); await ready(guest); await start();
    await data.rpc(guest, 'ng_leave_room', { p_request_id: randomUUID(), p_room_id: initial.id });
    await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role');
    const state = await snapshot(); expect(state.status).toBe('LOBBY'); expect(state.lastError).toContain('Roster changed');
  });
  it('cleans expired rooms and stale membership, and fences competing servers', async () => {
    await join();
    await data.db.query("update public.ng_room_members set last_seen_at=now()-interval '31 seconds' where user_id=$1",[host]);
    const instance = randomUUID(); await data.rpc(null, 'ng_server_tick', { p_instance_id: instance }, 'service_role');
    expect((await snapshot(guest)).hostMemberId).not.toBe(initial.selfMemberId);
    expect(await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role')).toMatchObject({ code: 'SERVER_BUSY' });
    await data.db.query("update public.ng_rooms set expires_at=now()-interval '1 second' where id=$1",[initial.id]);
    expect(await data.rpc(guest, 'ng_get_room', { p_room_id: initial.id })).toMatchObject({ code: 'ROOM_EXPIRED' });
    await data.rpc(null, 'ng_server_tick', { p_instance_id: instance }, 'service_role');
    expect(await data.rpc(guest, 'ng_get_room', { p_room_id: initial.id })).toMatchObject({ code: 'ROOM_MISSING' });
  });
  it('aborts old matches after server lease expiry and returns to lobby', async () => {
    await join(); await ready(host); await ready(guest); await start();
    await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role');
    await data.db.exec("update ng_private.runtime set lease_until=now()-interval '1 second'");
    await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role');
    const state = await snapshot(); expect(state.status).toBe('LOBBY'); expect(state.lastError).toContain('aborted');
  });
  it('returns the movement session to lobby and clears readiness', async () => {
    await join(); await ready(host); await ready(guest); await start(); await data.rpc(null, 'ng_server_tick', { p_instance_id: randomUUID() }, 'service_role');
    expect(await data.rpc(guest, 'ng_return_lobby', { p_request_id: randomUUID(), p_room_id: initial.id, p_revision:(await snapshot()).revision })).toMatchObject({ code:'HOST_ONLY' });
    const state=room(await data.rpc(host, 'ng_return_lobby', { p_request_id:randomUUID(), p_room_id:initial.id,p_revision:(await snapshot()).revision }));
    expect(state.status).toBe('LOBBY'); expect(state.members.every(m=>!m.ready)).toBe(true);
  });
  it('keeps verified sockets alive without recreating revoked membership', async () => {
    await join(); await ready(host); await ready(guest); await start(); const instance=randomUUID();
    await data.rpc(null,'ng_server_tick',{p_instance_id:instance},'service_role');
    await data.db.query("update public.ng_room_members set last_seen_at=now()-interval '20 seconds' where user_id=$1",[host]);
    await data.rpc(null,'ng_server_tick',{p_instance_id:instance,p_connected_members:[initial.selfMemberId]},'service_role');
    expect(await snapshot()).toBeTruthy();
    await data.db.query('delete from public.ng_room_members where user_id=$1',[host]);
    await data.rpc(null,'ng_server_tick',{p_instance_id:instance,p_connected_members:[initial.selfMemberId]},'service_role');
    expect(await data.rpc(host,'ng_get_room',{p_room_id:initial.id})).toMatchObject({code:'NOT_MEMBER'});
  });
  it('persists failed code-attempt limits and rejects invalid names', async () => {
    expect(await data.rpc(guest,'ng_create_room',{p_request_id:randomUUID(),p_name:'\n'})).toMatchObject({code:'INVALID_NAME'});
    for(let i=0;i<11;i++) await join(guest,randomUUID(),'BAD');
    expect(await join(guest,randomUUID(),'BAD')).toMatchObject({code:'RATE_LIMITED'});
  });
});
