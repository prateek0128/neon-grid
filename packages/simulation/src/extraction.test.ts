import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { EXTRACTION_RULES, parseClientMessage, parseServerMessage } from '@neon/protocol';
import { createGameplay, reconcileGameplay, advanceGameplay, gameplaySnapshot } from './gameplay.ts';
import { activateAbility, advanceAbilityPosition } from './abilities.ts';
import { advanceHazards } from './hazards.ts';
const setup = (x = 480, connected = true) => {
  const player = { id: randomUUID(), slot: 1, position: { x, y: 320 }, connected };
  const state = createGameplay(100, undefined, 20); reconcileGameplay(state, [player], () => 0);
  return { state, player };
};
it('opens at the configured tick and resolves lockdown at the existing deadline', () => {
  const { state, player } = setup(100); state.tick = 78;
  advanceGameplay(state, [player]); expect(state.extraction!.phase).toBe('closed');
  advanceGameplay(state, [player]); expect(state.extraction!.phase).toBe('open');
  state.tick = 99; advanceGameplay(state, [player]);
  expect(state.extraction).toMatchObject({ phase: 'lockdown', remainingTicks: 0, players: [{ id: player.id, outcome: 'locked_down' }] });
  const final = gameplaySnapshot(state); advanceGameplay(state, [player]); expect(gameplaySnapshot(state)).toEqual(final);
});
it.each([[539.999, 'extracted'], [540, 'extracted'], [540.001, 'alive']])('uses the inclusive player-center boundary at x=%s', (x, outcome) => {
  const { state, player } = setup(x as number); state.tick = 79; advanceGameplay(state, [player]);
  expect(state.extraction!.players[0]!.outcome).toBe(outcome);
});
it('cannot extract dead, disconnected or nonmembers and preserves dead deadline outcomes', () => {
  const { state, player } = setup(); state.vitals[0]!.life = 'respawning'; state.vitals[0]!.health = 0; state.vitals[0]!.respawnAtTick = 200;
  state.tick = 79; advanceGameplay(state, [player]); expect(state.extraction!.players[0]!.outcome).toBe('alive');
  state.tick = 99; advanceGameplay(state, [player]); expect(state.extraction!.players[0]!.outcome).toBe('dead');
  const disconnected = setup(480, false); disconnected.state.tick = 99; advanceGameplay(disconnected.state, [disconnected.player]);
  expect(disconnected.state.extraction!.players[0]!.outcome).toBe('locked_down');
  const outsider = setup(); outsider.state.tick = 79; advanceGameplay(outsider.state, [{ ...outsider.player, id: randomUUID() }]);
  expect(outsider.state.extraction!.players[0]!.outcome).toBe('alive');
});
it('scores before final-tick extraction, then freezes gameplay participation', () => {
  const { state, player } = setup(); state.cores[0]!.position = { ...player.position }; state.tick = 99;
  advanceGameplay(state, [player]); expect(state.match.results!.rankings[0]).toMatchObject({ score: 100, extractionOutcome: 'extracted' });
  expect(state.extraction!.players[0]!.extractedAtTick).toBe(100);
  const ongoing = setup(); ongoing.state.tick = 79; advanceGameplay(ongoing.state, [ongoing.player]);
  expect(advanceAbilityPosition(ongoing.state, ongoing.player.id, ongoing.player.position, { x: 1, y: 0 })).toEqual(ongoing.player.position);
  expect(activateAbility(ongoing.state, ongoing.player.id, 'shield', ongoing.player.position, null)).toBe('EXTRACTED');
  ongoing.state.cores[0]!.position = { ...ongoing.player.position }; const score = ongoing.state.scores[0]!.score;
  ongoing.state.tick = 240; ongoing.player.position.y = 220; advanceHazards(ongoing.state, [ongoing.player]);
  expect(ongoing.state.vitals[0]!.health).toBe(100);
  ongoing.player.position.y = 320; ongoing.state.tick = 81; advanceGameplay(ongoing.state, [ongoing.player]); expect(ongoing.state.scores[0]!.score).toBe(score);
  const snapshot = gameplaySnapshot(ongoing.state); snapshot.extraction!.players[0]!.outcome = 'alive';
  expect(ongoing.state.extraction!.players[0]!.outcome).toBe('extracted');
  const replay = createGameplay(100); reconcileGameplay(replay, [ongoing.player]);
  expect(replay.extraction!.players[0]).toMatchObject({ outcome: 'alive', extractedAtTick: null });
  expect(replay.extraction!.zone).toEqual(EXTRACTION_RULES.zone);
});
it.each(['position', 'health', 'extracted', 'outcome'])('rejects forged extraction field %s', field => {
  expect(parseClientMessage(JSON.stringify({ type: 'input', version: 1, sessionId: randomUUID(), sequence: 1, movement: { x: 0, y: 0 }, [field]: true }))).toBeNull();
  expect(parseClientMessage(JSON.stringify({ type: 'extract', version: 1, sessionId: randomUUID(), sequence: 1, [field]: true }))).toBeNull();
});
it('damage on the deadline precedes extraction even inside the zone', () => {
  const { state, player } = setup();
  // Tick 405 is laser-2 activation at x=640; no overlap with the fixed center zone.
  // Use the initial horizontal line at y=220 and a player-center zone fixture to isolate ordering.
  state.extraction!.zone = { x: 480, y: 220, radius: 60 };
  state.match.durationTicks = 225; state.extraction!.closesAtTick = 225; state.extraction!.opensAtTick = 220;
  player.position.y = 220; state.vitals[0]!.health = 50; state.tick = 224;
  advanceGameplay(state, [player]);
  expect(state.vitals[0]!.life).toBe('respawning'); expect(state.extraction!.players[0]!.outcome).toBe('dead');
  expect(state.match.results!.rankings[0]!.extractionOutcome).toBe('dead');
});

it('validates authoritative extraction timing and outcomes in snapshots', () => {
  const { state, player } = setup(); state.tick = 79; advanceGameplay(state, [player]);
  const snapshot = { type: 'snapshot', version: 1, epoch: state.match.id, tick: 80, players: [{ id: player.id, slot: 1, position: player.position, connected: true, lastSequence: -1 }], gameplay: gameplaySnapshot(state) };
  expect(parseServerMessage(JSON.stringify(snapshot))).not.toBeNull();
  for (const mutate of [
    (s: typeof snapshot) => { s.gameplay.extraction!.remainingTicks = 999; },
    (s: typeof snapshot) => { s.gameplay.extraction!.phase = 'lockdown'; },
    (s: typeof snapshot) => { s.gameplay.extraction!.players[0]!.outcome = 'locked_down'; },
    (s: typeof snapshot) => { s.gameplay.extraction!.players[0]!.extractedAtTick = 79; },
    (s: typeof snapshot) => { s.gameplay.extraction!.players.push({ ...s.gameplay.extraction!.players[0]! }); },
  ]) { const invalid = structuredClone(snapshot); mutate(invalid); expect(parseServerMessage(JSON.stringify(invalid))).toBeNull(); }
});
