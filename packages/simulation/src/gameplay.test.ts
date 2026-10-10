import { expect, it } from 'vitest';
import { ARENA, CORE_RULES, advanceGameplay, createGameplay, gameplaySnapshot, reconcileGameplay, validCoreCells } from './index.ts';
import type { GameplayPlayer } from './index.ts';

const a: GameplayPlayer = { id: '11111111-1111-4111-8111-111111111111', slot: 1, position: { x: 320, y: 220 }, connected: true };
const b: GameplayPlayer = { id: '22222222-2222-4222-8222-222222222222', slot: 2, position: { x: 640, y: 220 }, connected: true };
function setup(players = [a, b]) {
  const state = createGameplay();
  reconcileGameplay(state, players, () => 0);
  return state;
}

it('spawns eight unique cell-centered cores inside the existing arena excluding occupied cells and player overlap', () => {
  const players = [a, b, { ...a, id: 'third', position: { x: 20, y: 20 } }];
  const state = setup(players);
  expect(state.cores).toHaveLength(CORE_RULES.count);
  expect(new Set(state.cores.map(c => `${c.position.x},${c.position.y}`)).size).toBe(CORE_RULES.count);
  for (const core of state.cores) {
    expect(core.position.x % 40).toBe(20); expect(core.position.y % 40).toBe(20);
    expect(core.position.x).toBeGreaterThan(ARENA.radius); expect(core.position.x).toBeLessThan(ARENA.width - ARENA.radius);
    expect(core.position.y).toBeGreaterThan(ARENA.radius); expect(core.position.y).toBeLessThan(ARENA.height - ARENA.radius);
    for (const player of players) expect(Math.hypot(player.position.x - core.position.x, player.position.y - core.position.y)).toBeGreaterThan(ARENA.radius + CORE_RULES.radius);
  }
  expect(validCoreCells(players, state.cores).some(p => p.x === 20 && p.y === 20)).toBe(false);
  expect(validCoreCells(players, state.cores).some(p => p.x === 340 && p.y === 220)).toBe(false);
});

it('awards 100 once, marks collected core inactive and resolves a simultaneous tie by slot', () => {
  const state = setup(); const core = state.cores[0]!;
  const contenders = [{ ...b, position: core.position }, { ...a, position: core.position }];
  advanceGameplay(state, contenders, () => 0);
  expect(state.scores.find(s => s.id === a.id)?.score).toBe(100);
  expect(state.scores.find(s => s.id === b.id)?.score).toBe(0);
  expect(core.active).toBe(false); expect(state.events).toHaveLength(1);
  advanceGameplay(state, contenders, () => 0);
  expect(state.scores.find(s => s.id === a.id)?.score).toBe(100); expect(state.events).toHaveLength(1);
});

it('increases combos, clamps at 3x and expires at the server tick deadline', () => {
  const state = setup([a]);
  for (let i = 0; i < 4; i++) advanceGameplay(state, [{ ...a, position: state.cores[i]!.position }], () => 0);
  expect(state.scores[0]).toMatchObject({ score: 900, combo: 4, multiplier: 3 });
  expect(state.events.map(e => e.points)).toEqual([100, 200, 300, 300]);
  const deadline = state.scores[0]!.comboExpiresAtTick;
  while (state.tick < deadline - 1) advanceGameplay(state, [{ ...a, connected: false }], () => 0);
  expect(state.scores[0]!.combo).toBe(4);
  advanceGameplay(state, [{ ...a, connected: false }], () => 0);
  expect(state.scores[0]).toMatchObject({ score: 900, combo: 0, multiplier: 1, comboExpiresAtTick: 0 });
  advanceGameplay(state, [{ ...a, position: state.cores[0]!.position }], () => 0);
  expect(state.scores[0]!.score).toBe(1000);
});

it('respawns with a new identity after two seconds without overlapping players or other cores', () => {
  const state = setup([a]); const core = state.cores[0]!;
  const player = { ...a, position: core.position };
  advanceGameplay(state, [player], () => 0);
  for (let i = 0; i < CORE_RULES.respawnTicks - 1; i++) advanceGameplay(state, [player], () => 0);
  expect(state.cores[0]!.id).toBe(core.id);
  advanceGameplay(state, [player], () => 0);
  expect(state.cores[0]!.id).not.toBe(core.id); expect(state.cores[0]!.active).toBe(true);
  expect(state.scores[0]!.score).toBe(100);
  expect(state.cores[0]!.position).not.toEqual(player.position);
  expect(new Set(state.cores.map(c => `${c.position.x},${c.position.y}`)).size).toBe(CORE_RULES.count);
});

it('ignores disconnected players and unknown identities', () => {
  const state = setup([a]); const position = state.cores[0]!.position;
  advanceGameplay(state, [{ ...a, position, connected: false }, { ...b, position }], () => 0);
  advanceGameplay(state, [{ ...a, position, connected: false }, { ...b, position }], () => 0);
  expect(state.scores[0]!.score).toBe(0); expect(state.events).toHaveLength(0);
  expect(state.scores.some(s => s.id === b.id)).toBe(false);
});

it('keeps a bounded, ordered event history with unique reward identities', () => {
  const state = setup([a]);
  for (let i = 0; i < 20; i++) {
    const core = state.cores.find(c => c.active);
    if (core) advanceGameplay(state, [{ ...a, position: core.position }], () => 0);
    for (let j = 0; j < CORE_RULES.respawnTicks; j++) advanceGameplay(state, [{ ...a, connected: false }], () => 0);
  }
  expect(state.events).toHaveLength(CORE_RULES.eventLimit);
  expect(new Set(state.events.map(e => e.coreId)).size).toBe(CORE_RULES.eventLimit);
  expect(state.events.map(e => e.sequence)).toEqual(Array.from({ length: 16 }, (_, i) => i + 5));
});

it('snapshots preserve scores across reconnect, are isolated copies, and membership revocation removes scores', () => {
  const state = setup([a]);
  advanceGameplay(state, [{ ...a, position: state.cores[0]!.position }], () => 0);
  reconcileGameplay(state, [{ ...a, connected: false }], () => 0);
  const before = gameplaySnapshot(state);
  reconcileGameplay(state, [a], () => 0);
  expect(gameplaySnapshot(state)).toEqual(before);
  before.scores[0]!.score = 99999; before.cores[0]!.active = true;
  expect(state.scores[0]!.score).toBe(100); expect(state.cores[0]!.active).toBe(false);
  reconcileGameplay(state, [], () => 0); expect(state.scores).toHaveLength(0);
});
