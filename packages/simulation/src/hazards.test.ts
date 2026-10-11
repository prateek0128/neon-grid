import { expect, it } from 'vitest';
import { HAZARD_RULES, parseServerMessage } from '@neon/protocol';
import { activateAbility, advanceAbilityPosition, advanceGameplay, createGameplay, gameplaySnapshot, laserAtTick, laserCollision, reconcileGameplay, ARENA } from './index.ts';
const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  const player = { id, slot: 1, connected: true, position: { x: 320, y: 220 } };
  const state = createGameplay(); reconcileGameplay(state, [player], () => 0);
  return { state, player, vital: state.vitals[0]! };
}
it('has exact deterministic warning, active and off boundaries', () => {
  for (const [tick, phase] of [[179, 'idle'], [180, 'warning'], [224, 'warning'], [225, 'active'], [254, 'active'], [255, 'idle']] as const)
    expect(laserAtTick(tick).phase).toBe(phase);
  expect(laserAtTick(300)).toMatchObject({ id: 'laser-2', axis: 'x', coordinate: 640, phase: 'warning' });
  expect(laserAtTick(1140).axis).toBe('y');
});
it('detects body tangency and swept crossing without hitting outside the band', () => {
  const laser = laserAtTick(225);
  expect(laserCollision(laser, { x: 0, y: 239 })).toBe(true);
  expect(laserCollision(laser, { x: 0, y: 240 })).toBe(false);
  expect(laserCollision(laser, { x: 0, y: 250 }, { x: 0, y: 190 })).toBe(true);
});
it('damages once per activation, clamps health, freezes death and retains score', () => {
  const { state, player, vital } = setup(); state.tick = 224;
  advanceGameplay(state, [player]); expect(vital.health).toBe(50);
  for (let n = 0; n < 30; n++) advanceGameplay(state, [player]);
  expect(state.healthEvents).toHaveLength(1); expect(vital.health).toBe(50);
  vital.health = 1; state.scores[0]!.score = 300; state.scores[0]!.combo = 2;
  state.tick = 344; player.position.x = 640; advanceGameplay(state, [player]);
  expect(vital).toMatchObject({ health: 0, life: 'respawning', respawnAtTick: 435 });
  expect(state.healthEvents.at(-2)).toMatchObject({ kind: 'damage', amount: 1 });
  expect(state.scores[0]).toMatchObject({ score: 300, combo: 0 });
  expect(activateAbility(state, id, 'shield', player.position, null)).toBe('DEAD');
  expect(advanceAbilityPosition(state, id, player.position, { x: 1, y: 0 })).toEqual(player.position);
  player.position = { ...state.cores[0]!.position }; advanceGameplay(state, [player]);
  expect(state.scores[0]!.score).toBe(300);
});
it('blocks with active shield once, uses exact expiry and preserves cooldown', () => {
  const { state, player, vital } = setup(); state.tick = 224;
  expect(activateAbility(state, id, 'shield', player.position, null)).toBeNull();
  advanceGameplay(state, [player]); expect(vital.health).toBe(100);
  expect(state.healthEvents[0]!.kind).toBe('shield_blocked');
  state.abilities[0]!.shieldUntilTick = state.tick;
  advanceGameplay(state, [player]); expect(vital.health).toBe(100);
  expect(activateAbility(state, id, 'shield', player.position, null)).toBe('COOLDOWN');
  const expired = setup(); expired.state.tick = 224; expired.state.abilities[0]!.shieldUntilTick = 225;
  advanceGameplay(expired.state, [expired.player]); expect(expired.vital.health).toBe(50);
});
it('respawns on the deadline safely with health and exact invulnerability expiry', () => {
  const { state, player, vital } = setup(); vital.health = 50; state.tick = 224;
  advanceGameplay(state, [player]); const deadline = vital.respawnAtTick;
  state.tick = deadline - 2; advanceGameplay(state, [player]); expect(vital.life).toBe('respawning');
  advanceGameplay(state, [player]);
  expect(vital).toMatchObject({ health: 100, life: 'alive', invulnerableUntilTick: deadline + 45 });
  expect(laserCollision(state.hazards[0]!, player.position)).toBe(false);
  expect(player.position.x).toBeGreaterThanOrEqual(ARENA.radius);
  expect(player.position.y).toBeLessThanOrEqual(ARENA.height - ARENA.radius);
  expect(state.cores.some(c => Math.hypot(c.position.x - player.position.x, c.position.y - player.position.y) < 28)).toBe(false);
  player.position = { x: 640, y: 220 }; state.tick = 344; vital.invulnerableUntilTick = 346;
  advanceGameplay(state, [player]); expect(vital.health).toBe(100);
  expect(state.healthEvents.at(-1)!.kind).toBe('invulnerable_blocked');
  state.tick = 464; player.position = { x: 320, y: 420 }; vital.invulnerableUntilTick = 465;
  advanceGameplay(state, [player]); expect(vital.health).toBe(50);
});
it('preserves reconnect state, validates snapshots and clears membership/match state', () => {
  const { state, player, vital } = setup(); state.tick = 224; advanceGameplay(state, [player]);
  reconcileGameplay(state, [{ ...player, connected: false }]);
  const snapshot = gameplaySnapshot(state); reconcileGameplay(state, [player]);
  expect(gameplaySnapshot(state)).toEqual(snapshot);
  expect(parseServerMessage(JSON.stringify({ type: 'snapshot', version: 1, epoch: id, tick: 225, players: [], gameplay: snapshot }))).not.toBeNull();
  snapshot.vitals![0]!.health = 0; expect(vital.health).toBe(50);
  reconcileGameplay(state, []); expect(state.vitals).toHaveLength(0); expect(state.hazardHits.size).toBe(0);
  const fresh = setup(); expect(fresh.vital.health).toBe(HAZARD_RULES.maxHealth); expect(fresh.state.healthEvents).toHaveLength(0);
});
it('bounds the combined event history with unique global sequence numbers', () => {
  const { state, player } = setup();
  for (let cycle = 0; cycle < 24; cycle++) {
    state.tick = 224 + cycle * 120; const laser = laserAtTick(state.tick + 1);
    player.position = laser.axis === 'x' ? { x: laser.coordinate, y: 220 } : { x: 320, y: laser.coordinate };
    state.vitals[0]!.health = 100; state.vitals[0]!.life = 'alive';
    advanceGameplay(state, [player]);
  }
  const events = [...state.events, ...state.abilityEvents, ...state.healthEvents];
  expect(events).toHaveLength(16); expect(new Set(events.map(e => e.sequence)).size).toBe(16);
});
it('respawns disconnected members safely without overlapping another player', () => {
  const { state, player, vital } = setup(); player.connected = false;
  const other = { ...player, id: '22222222-2222-4222-8222-222222222222', slot: 2, connected: true, position: { x: 300, y: 220 } };
  reconcileGameplay(state, [player, other], () => 0);
  vital.health = 0; vital.life = 'respawning'; vital.respawnAtTick = 225; state.tick = 224;
  advanceGameplay(state, [player, other]);
  expect(vital.health).toBe(100); expect(laserCollision(state.hazards[0]!, player.position)).toBe(false);
  expect(Math.hypot(player.position.x - other.position.x, player.position.y - other.position.y)).toBeGreaterThan(28);
  reconcileGameplay(state, [{ ...player, connected: true }, other]);
  expect(state.vitals[0]!.respawnPosition).toEqual(player.position);
});

it('keeps full player-body spacing across neighboring respawn cells', () => {
  const { state, player, vital } = setup();
  const other = { ...player, id: '22222222-2222-4222-8222-222222222222', slot: 2, position: { x: 321, y: 237 } };
  reconcileGameplay(state, [player, other]); vital.health = 0; vital.life = 'respawning'; vital.respawnAtTick = 1;
  advanceGameplay(state, [player, other]);
  expect(Math.hypot(player.position.x - other.position.x, player.position.y - other.position.y)).toBeGreaterThan(ARENA.radius * 2);
});
