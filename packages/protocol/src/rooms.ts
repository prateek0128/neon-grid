export type RoomMember = { id: string; slot: number; displayName: string; ready: boolean; online: boolean };
export type RoomSnapshot = {
  id: string; code: string; status: 'LOBBY' | 'STARTING' | 'IN_MATCH'; revision: number;
  hostMemberId: string; selfMemberId: string; expiresAt: string; lastError: string | null;
  match: { id: string; startedAt: string | null; serverInstance: string | null } | null;
  members: RoomMember[];
};
export type RoomResult = { ok: true; room: RoomSnapshot } | { ok: true; left: true } | { ok: false; code: string; message: string };
export type RoomArena = { roomId: string; matchId: string; startedAt: string; members: { id: string; userId: string; slot: number }[] };
export function parseRoomResult(value: unknown): RoomResult {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid room response.');
  const result = value as Record<string, unknown>;
  if (result.ok === false && typeof result.code === 'string' && typeof result.message === 'string') return result as RoomResult;
  if (result.ok === true && result.left === true) return { ok: true, left: true };
  if (result.ok === true && result.room && typeof result.room === 'object') {
    const room = result.room as Record<string, unknown>;
    if (typeof room.id === 'string' && typeof room.code === 'string' && ['LOBBY', 'STARTING', 'IN_MATCH'].includes(String(room.status)) &&
      Number.isSafeInteger(room.revision) && typeof room.selfMemberId === 'string' && typeof room.hostMemberId === 'string' &&
      Array.isArray(room.members) && room.members.length <= 4 && room.members.every(m => m && typeof m.id === 'string' &&
        typeof m.displayName === 'string' && typeof m.ready === 'boolean' && typeof m.online === 'boolean' && Number.isInteger(m.slot))) return result as RoomResult;
  }
  throw new Error('Invalid room response.');
}
