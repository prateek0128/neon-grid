import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createSupabaseRooms, RoomAuthorityError } from './rooms.ts';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
it.each([
  [{ data: { ok: false, code: 'SERVER_BUSY', message: 'private-test-sentinel' }, error: null }, 'lease_busy'],
  [{ data: null, error: { code: '42501', message: 'private-test-sentinel', details: 'private-test-sentinel' } }, 'rpc_permission'],
  [{ data: null, error: { code: 'PGRST999', message: 'private-test-sentinel' } }, 'rpc_failure'],
  [{ data: { ok: true }, error: null }, 'invalid_response'],
])('classifies authority failure without carrying response details into logs', async (response, reason) => {
  rpc.mockResolvedValueOnce(response);
  const rooms = createSupabaseRooms('https://fixture.supabase.co', 'sb_publishable_test_fixture', 'sb_secret_test_fixture');
  const error = await rooms.tick(randomUUID(), []).catch(cause => cause);
  expect(error).toBeInstanceOf(RoomAuthorityError); expect(error.reason).toBe(reason);
  expect(error.message).toBe('Room authority unavailable.'); expect(JSON.stringify(error).includes('private-test-sentinel')).toBe(false);
});

it('classifies a rejected RPC promise without retaining its exception', async () => {
  rpc.mockRejectedValueOnce(new Error('private-test-sentinel'));
  const rooms = createSupabaseRooms('https://fixture.supabase.co', 'sb_publishable_test_fixture', 'sb_secret_test_fixture');
  const error = await rooms.tick(randomUUID(), []).catch(cause => cause);
  expect(error).toBeInstanceOf(RoomAuthorityError); expect(error.reason).toBe('rpc_failure');
  expect(error.message).toBe('Room authority unavailable.');
  expect(JSON.stringify(error)).not.toContain('private-test-sentinel'); expect(error.cause).toBeUndefined();
});
