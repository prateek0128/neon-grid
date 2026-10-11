export type ReadinessCondition = 'ready' | 'closing' | 'not_listening' | 'authority_pending' | 'authority_unhealthy' | 'authority_stale' | 'room_store_missing';
export function readinessCondition(state: { closing: boolean; listening: boolean; hasRooms: boolean; allowTestArena: boolean; healthy: boolean; hasSuccessfulSync: boolean; hasFailure: boolean; now: number; lastSync: number }): ReadinessCondition {
  if (state.closing) return 'closing';
  if (!state.listening) return 'not_listening';
  if (!state.hasRooms) return state.allowTestArena ? 'ready' : 'room_store_missing';
  if (!state.healthy) return !state.hasSuccessfulSync && !state.hasFailure ? 'authority_pending' : 'authority_unhealthy';
  return state.now - state.lastSync <= 5000 ? 'ready' : 'authority_stale';
}
