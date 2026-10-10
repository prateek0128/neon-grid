import type { SupabaseClient } from '@supabase/supabase-js';
import { parseRoomResult } from '@neon/protocol';
import type { RoomSnapshot } from '@neon/protocol';
import { AuthenticationError, browserSession } from './auth';

export class RoomError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export async function roomRpc(auth: SupabaseClient, name: string, parameters: Record<string, unknown> = {}): Promise<RoomSnapshot | null> {
  // Retry transport failures with the same request identifier; semantic errors are never blindly retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!await browserSession(auth)) throw new AuthenticationError('Sign in before accessing rooms. Please try Create Room or Join Room.');
    const { data, error } = await auth.rpc(name, parameters);
    if (error) {
      if (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST303') {
        throw new AuthenticationError('Room access was denied. Check your session and try again; automatic room polling has stopped.');
      }
      if (attempt === 0 && (!error.code || error.code === 'PGRST000')) continue;
      throw new RoomError(error.code ?? 'NETWORK', 'Room service unavailable. Check your connection and database setup.');
    }
    const result = parseRoomResult(data);
    if (!result.ok) throw new RoomError(result.code, result.message);
    return 'room' in result ? result.room : null;
  }
  throw new RoomError('NETWORK', 'Room request failed.');
}
