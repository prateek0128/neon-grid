import { afterEach, expect, it, vi } from 'vitest';
import { loadStats, recordAuthoritativeResult } from './player-stats';
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
afterEach(() => storage.clear());
it('records an authoritative result once and retains personal bests', () => {
  const result = { matchId: 'match-1', durationTicks: 1, outcome: 'winner' as const, winnerIds: ['me'], rankings: [{ id: 'me', slot: 1, rank: 1, score: 350, coresCollected: 2 }] };
  expect(recordAuthoritativeResult(result, 'me')).toMatchObject({ wins: 1, losses: 0, highestScore: 350, coresCollected: 2 });
  expect(recordAuthoritativeResult(result, 'me')).toEqual(loadStats());
});
