import { expect, it } from 'vitest';
import { ABILITY_RULES, TICK_RATE } from '@neon/protocol';
import { activateAbility, advanceAbilityPosition, advanceGameplay, ARENA, cancelDash, createGameplay, gameplaySnapshot, reconcileGameplay } from './index.ts';
const player = { id: '11111111-1111-4111-8111-111111111111', slot: 1, connected: true, position: { x: 320, y: 220 } };
function setup() { const state = createGameplay(); reconcileGameplay(state, [player], () => 0); return state; }

it('rejects absent/invalid dash directions without starting a cooldown', () => {
  const state = setup();
  for (const direction of [null, { x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 2, y: 0 }]) {
    expect(activateAbility(state, player.id, 'dash', player.position, direction)).toBe('NO_DIRECTION');
  }
  expect(state.abilities[0]!.dashReadyAtTick).toBe(0); expect(state.abilityEvents).toHaveLength(0);
});

it('normalizes recent direction and integrates exactly six faster steps without trusting movement changes mid-dash', () => {
  const state = setup(); activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 1 });
  let position = { ...player.position };
  for (let i = 0; i < ABILITY_RULES.dashDurationTicks; i++) {
    position = advanceAbilityPosition(state, player.id, position, { x: -1, y: 0 });
    state.tick++;
  }
  const distance = ARENA.speed * ABILITY_RULES.dashSpeedMultiplier * ABILITY_RULES.dashDurationTicks / TICK_RATE;
  expect(Math.hypot(position.x - player.position.x, position.y - player.position.y)).toBeCloseTo(distance);
  const after = advanceAbilityPosition(state, player.id, position, { x: -1, y: 0 });
  expect(after.x).toBeCloseTo(position.x - ARENA.speed / TICK_RATE); expect(after.y).toBe(position.y);
});

it('enforces the five-second cooldown including repeated requests at its exact boundary', () => {
  const state = setup();
  expect(activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 })).toBeNull();
  for (let i = 0; i < 100; i++) expect(activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 })).toBe('COOLDOWN');
  expect(state.abilityEvents).toHaveLength(1);
  state.tick = ABILITY_RULES.dashCooldownTicks - 1;
  expect(activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 })).toBe('COOLDOWN');
  state.tick++;
  expect(activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 })).toBeNull();
});

it.each([{ x: -1, y: -1 }, { x: 1, y: 1 }])('keeps dash within all solid arena boundaries', direction => {
  const state = setup(); activateAbility(state, player.id, 'dash', player.position, direction);
  let position = direction.x < 0 ? { x: ARENA.radius, y: ARENA.radius } : { x: ARENA.width - ARENA.radius, y: ARENA.height - ARENA.radius };
  const initial = { ...position };
  for (let i = 0; i < 6; i++) { position = advanceAbilityPosition(state, player.id, position, direction); state.tick++; }
  expect(position).toEqual(initial);
});

it('enforces two-second shield expiry and twelve-second cooldown without extending on repeated activation', () => {
  const state = setup(); expect(activateAbility(state, player.id, 'shield', player.position, null)).toBeNull();
  const ability = state.abilities[0]!;
  expect(ability.shieldUntilTick).toBe(60); expect(ability.shieldReadyAtTick).toBe(360);
  state.tick = 59; expect(state.tick < ability.shieldUntilTick).toBe(true);
  expect(activateAbility(state, player.id, 'shield', player.position, null)).toBe('COOLDOWN');
  state.tick = 60; expect(state.tick < ability.shieldUntilTick).toBe(false);
  state.tick = 359; expect(activateAbility(state, player.id, 'shield', player.position, null)).toBe('COOLDOWN');
  expect(ability.shieldUntilTick).toBe(60); expect(state.abilityEvents).toHaveLength(1);
  state.tick = 360; expect(activateAbility(state, player.id, 'shield', player.position, null)).toBeNull();
  expect(ability.shieldUntilTick).toBe(420);
});

it('preserves shield/cooldowns across disconnect and snapshot reads but cancels the burst', () => {
  const state = setup(); activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 });
  activateAbility(state, player.id, 'shield', player.position, null);
  state.tick = 1; cancelDash(state, player.id);
  reconcileGameplay(state, [{ ...player, connected: false }], () => 0);
  const snapshot = gameplaySnapshot(state);
  reconcileGameplay(state, [player], () => 0);
  expect(gameplaySnapshot(state)).toEqual(snapshot);
  expect(state.abilities[0]).toMatchObject({ dashUntilTick: 1, dashReadyAtTick: 150, shieldUntilTick: 60, shieldReadyAtTick: 360 });
  snapshot.abilities![0]!.shieldReadyAtTick = 0;
  expect(state.abilities[0]!.shieldReadyAtTick).toBe(360);
  reconcileGameplay(state, [], () => 0); expect(state.abilities).toHaveLength(0);
  expect(activateAbility(state, player.id, 'shield', player.position, null)).toBe('NOT_MEMBER');
  expect(createGameplay().abilities).toHaveLength(0);
});

it('orders abilities and core pickups with one counter and bounds their combined history', () => {
  const state = setup(); activateAbility(state, player.id, 'shield', player.position, null);
  advanceGameplay(state, [{ ...player, position: state.cores[0]!.position }], () => 0);
  activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 });
  expect(state.abilityEvents.map(e => e.sequence)).toEqual([1, 3]); expect(state.events[0]!.sequence).toBe(2);
  for (let i = 0; i < 20; i++) {
    state.tick += ABILITY_RULES.dashCooldownTicks;
    activateAbility(state, player.id, 'dash', player.position, { x: 1, y: 0 });
  }
  expect(state.abilityEvents.length + state.events.length).toBe(16);
  expect(new Set([...state.abilityEvents, ...state.events].map(e => e.sequence)).size).toBe(16);
});
