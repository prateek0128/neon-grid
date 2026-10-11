import { createClient } from '@supabase/supabase-js';
import { parseRoomResult } from '@neon/protocol';
import type { RoomArena } from '@neon/protocol';

export type RoomAuthorization = { id: string; slot: number; host?: boolean; revision?: number };
export type RoomStore = {
  returnLobby?(token: string, roomId: string, revision: number): Promise<boolean>;
  tick(instanceId: string, connectedMembers: string[]): Promise<RoomArena[]>;
  authorize(token: string, roomId: string, matchId: string, instanceId: string): Promise<RoomAuthorization | null>;
};
export function createSupabaseRooms(url: string, publicKey: string, serverKey: string): RoomStore {
  const settings = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) }) } };
  const operations = createClient(url, serverKey, settings);
  return {
    async returnLobby(token, roomId, revision) {
      const user = createClient(url, publicKey, { ...settings, global: { ...settings.global, headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await user.rpc('ng_return_lobby', { p_request_id: crypto.randomUUID(), p_room_id: roomId, p_revision: revision });
      if (error) throw new Error('Room return unavailable.');
      const result = parseRoomResult(data);
      return result.ok && 'room' in result && result.room.status === 'LOBBY';
    },
    async tick(instanceId, connectedMembers) {
      const { data, error } = await operations.rpc('ng_server_tick', { p_instance_id: instanceId, p_connected_members: connectedMembers });
      if (error || !data?.ok || !Array.isArray(data.arenas)) throw new Error('Room authority unavailable.');
      return data.arenas as RoomArena[];
    },
    async authorize(token, roomId, matchId, instanceId) {
      const user = createClient(url, publicKey, { ...settings, global: { ...settings.global, headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await user.rpc('ng_get_room', { p_room_id: roomId });
      if (error) throw new Error('Room authorization unavailable.');
      const result = parseRoomResult(data);
      if (!result.ok || !('room' in result)) return null;
      const room = result.room;
      if (room.status !== 'IN_MATCH' || room.match?.id !== matchId || room.match.serverInstance !== instanceId) return null;
      const member = room.members.find(m => m.id === room.selfMemberId && m.online);
      return member ? { id: member.id, slot: member.slot, host: room.hostMemberId === member.id, revision: room.revision } : null;
    },
  };
}
