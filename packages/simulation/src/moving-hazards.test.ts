import { expect, it } from 'vitest';
import { DIFFICULTY_RULES, HAZARD_RULES, parseClientMessage, parseServerMessage } from '@neon/protocol';
import { difficultyAtTick, laserAtTick, laserCollision, advanceHazards, safeRespawnPosition } from './hazards.ts';
import { createGameplay, reconcileGameplay, advanceGameplay, gameplaySnapshot } from './gameplay.ts';
const id = '11111111-1111-4111-8111-111111111111';
function setup(tick = 945) {
  const laser = laserAtTick(tick); const player = { id, slot: 1, connected: true, position: { x: 480, y: 320 } };
  player.position[laser.axis] = laser.coordinate;
  const state = createGameplay(); reconcileGameplay(state, [player], () => 0); state.tick = tick;
  return { state, player, vital: state.vitals[0]!, laser };
}
it('progresses at exact 30/60 second boundaries without changing match/extraction deadlines', () => {
  expect([899, 900, 1799, 1800].map(difficultyAtTick)).toEqual([1, 2, 2, 3]);
  const state = createGameplay(); const deadline = state.match.durationTicks; const opens = state.extraction!.opensAtTick;
  state.tick = 1799; advanceGameplay(state, []);
  expect(state.difficultyStage).toBe(3); expect(state.match.durationTicks).toBe(deadline); expect(state.extraction!.opensAtTick).toBe(opens);
  expect(laserAtTick(1800).stage).toBe(2); expect(laserAtTick(1860).stage).toBe(3);
});
it('keeps every pattern deterministic, bounded and fully warned with no overlapping activations', () => {
  const directions = new Set<string>(); let previousWarning = -1;
  for (let tick = 0; tick <= 3600; tick++) {
    const laser = laserAtTick(tick); expect(laser).toEqual(laserAtTick(tick));
    expect(laser.coordinate).toBeGreaterThanOrEqual(0); expect(laser.coordinate).toBeLessThanOrEqual(laser.axis === 'x' ? 960 : 640);
    expect(laser.activeAtTick - laser.warningAtTick).toBe(HAZARD_RULES.warningTicks);
    if (laser.motion) {
      directions.add(`${laser.axis}:${laser.motion.direction}`);
      expect(laser.motion.speed).toBeLessThanOrEqual(200); expect(laser.motion.speed).toBeLessThan(210);
      expect(laser.motion.from).toBeGreaterThanOrEqual(40); expect(laser.motion.to).toBeGreaterThanOrEqual(40);
      expect(laser.motion.to).toBeLessThanOrEqual((laser.axis === 'x' ? 960 : 640) - 40);
    }
    if (laser.warningAtTick !== previousWarning) {
      if (previousWarning >= 0) expect(laser.warningAtTick).toBeGreaterThanOrEqual(laserAtTick(previousWarning).endsAtTick);
      previousWarning = laser.warningAtTick;
    }
  }
  expect(laserAtTick(3600 * 30).coordinate).toBeGreaterThanOrEqual(40);
  expect(directions).toEqual(new Set(['x:1', 'x:-1', 'y:1', 'y:-1']));
});
it('moves only after the complete warning and stops at the bounded endpoint', () => {
  const warning = laserAtTick(900); expect(warning.phase).toBe('warning'); expect(warning.coordinate).toBe(warning.motion!.from);
  expect(laserAtTick(944).phase).toBe('warning'); expect(laserAtTick(945).coordinate).toBe(warning.coordinate);
  expect(laserAtTick(946).coordinate).toBeCloseTo(warning.coordinate - 160 / 30);
  expect(laserAtTick(1004).phase).toBe('active'); expect(laserAtTick(1005)).toMatchObject({ phase: 'idle', coordinate: warning.motion!.to });
});
it('uses relative swept collision with inclusive tangency and simultaneous opposite player motion', () => {
  const laser = laserAtTick(946); const point = { x: 480, y: laser.previousCoordinate! + 19 };
  expect(laserCollision(laser, point)).toBe(true);
  expect(laserCollision(laser, { ...point, y: point.y + .001 })).toBe(false);
  expect(laserCollision(laser, { x: 480, y: laser.coordinate - 20 }, { x: 480, y: laser.previousCoordinate! + 20 })).toBe(true);
});
it.each(['shield', 'invulnerable', 'dead', 'disconnected', 'extracted'] as const)('preserves %s protection during a sweep', mode => {
  const { state, player, vital } = setup();
  if (mode === 'shield') state.abilities[0]!.shieldUntilTick = state.tick + 1;
  if (mode === 'invulnerable') vital.invulnerableUntilTick = state.tick + 1;
  if (mode === 'dead') { vital.health = 0; vital.life = 'respawning'; vital.respawnAtTick = state.tick + 90; }
  if (mode === 'disconnected') player.connected = false;
  if (mode === 'extracted') { state.extraction!.players[0]!.outcome = 'extracted'; state.extraction!.players[0]!.extractedAtTick = 900; }
  advanceHazards(state, [player]); expect(vital.health).toBe(mode === 'dead' ? 0 : 100);
  if (mode === 'shield' || mode === 'invulnerable') {
    state.abilities[0]!.shieldUntilTick = state.tick; vital.invulnerableUntilTick = state.tick;
    state.tick++; player.position.y = laserAtTick(state.tick).coordinate; advanceHazards(state, [player]); expect(vital.health).toBe(100);
  }
});
it('damages once per sweep and respawns outside the advertised swept corridor', () => {
  const { state, player, vital } = setup(); advanceHazards(state, [player]); expect(vital.health).toBe(50);
  state.tick++; player.position.y = laserAtTick(state.tick).coordinate; advanceHazards(state, [player]); expect(vital.health).toBe(50);
  const safe = safeRespawnPosition(state, player, [player]);
  const motion = state.hazards[0]!.motion!; expect(safe.y < Math.min(motion.from, motion.to) - 19 || safe.y > Math.max(motion.from, motion.to) + 19).toBe(true);
});
it('serializes and validates moving positions and rejects forged motion/outcomes', () => {
  const { state, player } = setup(960); state.tick = 959; advanceGameplay(state, [player]);
  const snapshot = { type: 'snapshot', version: 1, epoch: state.match.id, tick: state.tick, players: [], gameplay: gameplaySnapshot(state) };
  expect(parseServerMessage(JSON.stringify(snapshot))).not.toBeNull();
  for (const field of ['coordinate', 'previousCoordinate', 'stage', 'pattern']) {
    const copy = structuredClone(snapshot); (copy.gameplay.hazards![0] as unknown as Record<string, unknown>)[field] = 9999;
    expect(parseServerMessage(JSON.stringify(copy))).toBeNull();
  }
  const mismatched = structuredClone(snapshot); mismatched.gameplay.hazards![0]!.pattern = 'vertical-right';
  expect(parseServerMessage(JSON.stringify(mismatched))).toBeNull();
  const legacy = structuredClone(snapshot); delete legacy.gameplay.hazards![0]!.pattern;
  expect(parseServerMessage(JSON.stringify(legacy))).not.toBeNull();
  for (const field of ['motion', 'hazards', 'damage', 'difficultyStage', 'pattern']) expect(parseClientMessage(JSON.stringify({ type: 'input', version: 1, sessionId: id, sequence: 1, movement: { x: 0, y: 0 }, [field]: true }))).toBeNull();
  expect(DIFFICULTY_RULES.stage3IntervalTicks).toBeGreaterThanOrEqual(HAZARD_RULES.warningTicks + DIFFICULTY_RULES.movingActiveTicks);
});

it.each([
  [945, 'horizontal-up'], [1065, 'vertical-left'],
  [1185, 'horizontal-down'], [1305, 'vertical-right'],
] as const)('issues the deterministic %s pattern and preserves collision/protection', (tick, pattern) => {
  const { state, player, vital, laser } = setup(tick);
  expect(laser.pattern).toBe(pattern);
  expect(laserAtTick(tick - 1)).toMatchObject({ pattern, phase: 'warning' });
  const outside = { ...player.position, [laser.axis]: laser.coordinate + 19.001 };
  expect(laserCollision(laser, outside)).toBe(false);
  expect(laserCollision(laser, { ...outside, [laser.axis]: laser.coordinate + 19 })).toBe(true);
  state.abilities[0]!.shieldUntilTick = tick + 1;
  advanceHazards(state, [player]); expect(vital.health).toBe(100);
  const unprotected = setup(tick); advanceHazards(unprotected.state, [unprotected.player]);
  expect(unprotected.vital.health).toBe(50);
  expect(laserAtTick(laser.endsAtTick)).toMatchObject({ pattern, phase: 'idle', coordinate: laser.motion!.to });
});
