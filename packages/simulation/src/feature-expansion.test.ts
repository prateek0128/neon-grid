import { expect, it } from 'vitest';
import { advanceGameplay, advancePosition, createGameplay, gameplaySnapshot, layoutForGeneration, reconcileGameplay } from './index.ts';
import { parseServerMessage } from '@neon/protocol';
import type { GameplayPlayer } from './index.ts';
const player: GameplayPlayer = { id: '11111111-1111-4111-8111-111111111111', slot: 1, position: { x: 320, y: 220 }, connected: true };
function setup() { const state = createGameplay(2700, '11111111-1111-4111-8111-111111111111'); reconcileGameplay(state, [player], () => 0); return state; }
it('spawns each server-owned power-up once and applies bounded score, energy and speed effects', () => {
  const state = setup();
  for (const powerup of state.powerups) powerup.spawnAtTick = 0;
  advanceGameplay(state, [player], () => 0);
  for (const powerup of state.powerups) {
    const collector = { ...player, position: { ...powerup.position } };
    advanceGameplay(state, [collector], () => 0);
    expect(powerup).toMatchObject({ active: false, collectedBy: player.id });
  }
  const ability = state.abilities[0]!;
  expect(ability.speedUntilTick).toBeGreaterThan(state.tick);
  expect(ability.dashReadyAtTick).toBe(state.tick);
  expect(ability.shieldReadyAtTick).toBe(state.tick);
  expect(state.scores[0]!.score).toBeGreaterThanOrEqual(150);
  expect(gameplaySnapshot(state).powerups).toHaveLength(3);
});
it('chooses deterministic layouts, serializes their obstacles, and blocks a movement step into a wall', () => {
  const layout = [...Array(100).keys()].map(index => layoutForGeneration(`vault-${index}`)).find(value => value.id === 'vault')!;
  const stopped = advancePosition({ x: layout.obstacles[0]!.x - 15, y: layout.obstacles[0]!.y + 50 }, { x: 1, y: 0 }, 1, layout);
  expect(stopped.x).toBeLessThan(layout.obstacles[0]!.x);
  const state = createGameplay(2700, 'vault-3');
  expect(gameplaySnapshot(state).arena?.obstacles).toEqual(state.arena.obstacles);
});
it('never exposes the server-only power-up spawn deadline in snapshots', () => {
  const state = setup();
  expect(JSON.stringify(gameplaySnapshot(state).powerups)).not.toContain('spawnAtTick');
});
it('keeps the pre-existing strict snapshot shape valid alongside additive state', () => {
  const state = setup();
  const gameplay = gameplaySnapshot(state);
  // The existing protocol parser remains strict for its original required shape.
  for (const ability of gameplay.abilities ?? []) delete ability.speedUntilTick;
  delete gameplay.powerups; delete gameplay.arena;
  const raw = JSON.stringify({ type: 'snapshot', version: 1, epoch: '11111111-1111-4111-8111-111111111111', tick: 0, players: [{ ...player, lastSequence: -1 }], gameplay });
  expect(parseServerMessage(raw)).not.toBeNull();
});
