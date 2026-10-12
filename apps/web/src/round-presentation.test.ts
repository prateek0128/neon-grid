import { expect, it } from 'vitest';
import { createGameplay, gameplaySnapshot } from '@neon/simulation';
import { personalOutcome, roundPresentation } from './round-presentation';
it('uses only authoritative ticks for the final ten seconds and completed state', () => {
  const state = createGameplay(); state.tick = 2400;
  expect(roundPresentation(gameplaySnapshot(state))).toMatchObject({ seconds: 10, urgent: true });
  state.match.phase = 'RESULTS'; expect(roundPresentation(gameplaySnapshot(state)).urgent).toBe(false);
  expect(roundPresentation().seconds).toBeNull();
});
it('distinguishes personal victory, ties and defeat without changing rankings', () => {
  const results = { matchId: 'm', durationTicks: 2700, outcome: 'tie' as const, winnerIds: ['a'], rankings: [{ id: 'a', rank: 1, slot: 1, score: 100, coresCollected: 1, extractionOutcome: 'extracted' as const }, { id: 'b', rank: 2, slot: 2, score: 0, coresCollected: 0 }] };
  expect(personalOutcome(results, 'a')).toBe('Shared victory · escaped the grid');
  expect(personalOutcome(results, 'b')).toContain('outscored');
});
