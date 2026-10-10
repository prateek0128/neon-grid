import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthenticationError, ensureBrowserIdentity } from './auth';
import { roomRpc } from './room-client';

const session = { access_token: 'test-only-token', user: { id: 'test-player' } };
function fixture(initial: typeof session | null = null) {
  const getSession = vi.fn().mockResolvedValue({ data: { session: initial }, error: null });
  const signInAnonymously = vi.fn();
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true, left: true }, error: null });
  const client = { auth: { getSession, signInAnonymously }, rpc } as unknown as SupabaseClient;
  return { client, getSession, signInAnonymously, rpc };
}

it('blocks room RPCs without a session', async () => {
  const f = fixture();
  await expect(roomRpc(f.client, 'ng_get_room')).rejects.toBeInstanceOf(AuthenticationError);
  expect(f.rpc).not.toHaveBeenCalled();
});

it('awaits anonymous sign-in and session persistence before room RPCs', async () => {
  const f = fixture();
  let complete!: () => void;
  f.signInAnonymously.mockImplementation(() => new Promise(resolve => {
    complete = () => {
      f.getSession.mockResolvedValue({ data: { session }, error: null });
      resolve({ data: { session }, error: null });
    };
  }));
  const action = ensureBrowserIdentity(f.client).then(() => roomRpc(f.client, 'ng_get_room'));
  await vi.waitFor(() => expect(f.signInAnonymously).toHaveBeenCalledOnce());
  expect(f.rpc).not.toHaveBeenCalled();
  complete();
  await action;
  expect(f.rpc).toHaveBeenCalledOnce();
});

it('reuses a valid session without signing up again', async () => {
  const f = fixture(session);
  await ensureBrowserIdentity(f.client);
  expect(f.signInAnonymously).not.toHaveBeenCalled();
});

it('surfaces sign-in errors and blocks incomplete sign-in', async () => {
  const f = fixture();
  f.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'Signup disabled' } });
  await expect(ensureBrowserIdentity(f.client)).rejects.toThrow('Anonymous sign-in failed: Signup disabled');
  f.signInAnonymously.mockResolvedValue({ data: { session: null }, error: null });
  await expect(ensureBrowserIdentity(f.client)).rejects.toThrow('did not establish a session');
  expect(f.rpc).not.toHaveBeenCalled();
});

it('blocks RPCs when session recovery fails', async () => {
  const f = fixture(session);
  f.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Refresh failed' } });
  await expect(roomRpc(f.client, 'ng_get_room')).rejects.toThrow('Session recovery failed');
  expect(f.rpc).not.toHaveBeenCalled();
});

it('does not retry a permission denial', async () => {
  const f = fixture(session);
  f.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  await expect(roomRpc(f.client, 'ng_get_room')).rejects.toThrow('Room access was denied');
  expect(f.rpc).toHaveBeenCalledOnce();
});
