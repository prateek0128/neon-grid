import { expect, it } from 'vitest';
import { parseServerMessage } from '@neon/protocol';
import { activateAbility, advanceAbilityPosition, advanceGameplay, createGameplay, finalizeGameplay, gameplaySnapshot, reconcileGameplay } from './index.ts';
const a = { id: '11111111-1111-4111-8111-111111111111', slot: 1, connected: true, position: { x: 320, y: 220 } };
const b = { id: '22222222-2222-4222-8222-222222222222', slot: 2, connected: true, position: { x: 640, y: 220 } };
function setup(ticks = 3) { const state = createGameplay(ticks); reconcileGameplay(state, [a, b], () => 0); return state; }
it('finishes at the authoritative deadline including deterministic final-step collection', () => {
  const state = setup(); expect(finalizeGameplay(state)).toBe(false);
  advanceGameplay(state, [a, b]); advanceGameplay(state, [a, b]); expect(state.match.phase).toBe('ACTIVE');
  advanceGameplay(state, [{ ...a, position: state.cores[0]!.position }, { ...b, position: state.cores[0]!.position }]);
  expect(state.match).toMatchObject({ phase: 'RESULTS', endedAtTick: 3 });
  expect(state.match.results).toMatchObject({ durationTicks: 3, outcome: 'winner', winnerIds: [a.id], rankings: [{ id: a.id, rank: 1, score: 100, coresCollected: 1 }, { id: b.id, rank: 2, score: 0, coresCollected: 0 }] });
  expect(parseServerMessage(JSON.stringify({ type: 'snapshot', version: 1, epoch: state.match.id, tick: 3, players: [], gameplay: gameplaySnapshot(state) }))).not.toBeNull();
});
it('freezes all finalized gameplay and emits no second completion', () => {
  const state = setup(1); advanceGameplay(state, [a, b]); const frozen = gameplaySnapshot(state);
  for (let n = 0; n < 20; n++) { advanceGameplay(state, [{ ...a, position: state.cores[0]!.position }]); reconcileGameplay(state, []); }
  expect(finalizeGameplay(state)).toBe(false); expect(gameplaySnapshot(state)).toEqual(frozen);
  expect(activateAbility(state, a.id, 'shield', a.position, null)).toBe('MATCH_ENDED');
  expect(advanceAbilityPosition(state, a.id, a.position, { x: 1, y: 1 })).toEqual(a.position);
  const snapshot = gameplaySnapshot(state); snapshot.match!.results!.rankings[0]!.score = 999;
  expect(state.match.results!.rankings[0]!.score).toBe(0);
});
it('reports a real tie in stable slot order, including disconnected participants', () => {
  const state = setup(1); advanceGameplay(state, [{ ...b, connected: false }, { ...a, connected: false }]);
  expect(state.match.results).toMatchObject({ outcome: 'tie', winnerIds: [a.id, b.id], rankings: [{ id: a.id, rank: 1 }, { id: b.id, rank: 1 }] });
});
it('retains departed players and cumulative core statistics beyond the event history', () => {
  const state = setup(2000);
  for (let n = 0; n < 18; n++) { const core = state.cores.find(c => c.active)!; advanceGameplay(state, [{ ...a, position: core.position }, b], () => 0); state.tick += 60; }
  const total = state.scores[0]!.score;
  reconcileGameplay(state, [b]); state.tick = 1999; advanceGameplay(state, [b]);
  expect(state.match.results!.rankings[0]).toMatchObject({ id: a.id, score: total, coresCollected: 18 });
});
it('handles empty results without inventing a winner and validates duration', () => {
  const empty = createGameplay(1); advanceGameplay(empty, []);
  expect(empty.match.results).toMatchObject({ outcome: 'empty', rankings: [], winnerIds: [] });
  for (const ticks of [0, -1, 1.5, Infinity]) expect(() => createGameplay(ticks)).toThrow();
});
it('new generations reset all match fields while preserving member identities', () => {
  const old = setup(500); activateAbility(old, a.id, 'shield', a.position, null);
  advanceGameplay(old, [{ ...a, position: old.cores[0]!.position }, b]); old.tick = 224; advanceGameplay(old, [a, b]); old.tick = 499; advanceGameplay(old, [a, b]);
  const fresh = setup(500); expect(fresh.match.id).not.toBe(old.match.id);
  expect(fresh.match).toMatchObject({ phase: 'ACTIVE', endedAtTick: null, results: null });
  expect(fresh.tick).toBe(0); expect(fresh.events).toHaveLength(0); expect(fresh.healthEvents).toHaveLength(0); expect(fresh.abilityEvents).toHaveLength(0); expect(fresh.hazardHits.size).toBe(0);
  expect(fresh.scores).toEqual([a, b].map(p => ({ id: p.id, score: 0, combo: 0, multiplier: 1, comboExpiresAtTick: 0 })));
  expect(fresh.abilities.every(p => p.dashUntilTick === 0 && p.dashReadyAtTick === 0 && p.shieldUntilTick === 0 && p.shieldReadyAtTick === 0)).toBe(true);
  expect(fresh.vitals.every(p => p.health === 100 && p.life === 'alive' && p.respawnAtTick === 0 && p.invulnerableUntilTick === 0)).toBe(true);
  expect(fresh.cores.every(p => p.active && p.respawnAtTick === 0)).toBe(true); expect(fresh.hazards[0]).toMatchObject({ id: 'laser-1', phase: 'idle', warningAtTick: 180 });
  expect(old.match.phase).toBe('RESULTS'); expect(old.match.results).not.toBeNull();
});
it('uses competition ranking for lower-place ties without declaring extra winners', () => {
  const state = setup(1);
  const c = { ...a, id: '33333333-3333-4333-8333-333333333333', slot: 3 };
  const d = { ...b, id: '44444444-4444-4444-8444-444444444444', slot: 4 };
  reconcileGameplay(state, [a, b, c, d]);
  state.participants.get(a.id)!.score = 300; state.participants.get(b.id)!.score = 100;
  state.participants.get(c.id)!.score = 100;
  advanceGameplay(state, []);
  expect(state.match.results!.rankings.map(p => p.rank)).toEqual([1, 2, 2, 4]);
  expect(state.match.results!.winnerIds).toEqual([a.id]);
});
