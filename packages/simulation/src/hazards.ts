import { HAZARD_RULES, DIFFICULTY_RULES, TICK_RATE } from '@neon/protocol';
import type { HealthEvent, LaserState, Vector } from '@neon/protocol';
import { ARENA, spawnPosition } from './index.ts';
import { validCoreCells } from './gameplay.ts';
import type { GameplayPlayer, GameplayState } from './gameplay.ts';

const patterns = [{ axis: 'y', coordinate: 220 }, { axis: 'x', coordinate: 640 }, { axis: 'y', coordinate: 420 }, { axis: 'x', coordinate: 320 },
  { axis: 'y', coordinate: 100 }, { axis: 'x', coordinate: 800 }, { axis: 'y', coordinate: 540 }, { axis: 'x', coordinate: 160 }] as const;
export function difficultyAtTick(tick: number): 1 | 2 | 3 {
  return tick >= DIFFICULTY_RULES.stage3Tick ? 3 : tick >= DIFFICULTY_RULES.stage2Tick ? 2 : 1;
}
export function laserAtTick(tick: number): LaserState {
  let cycle = 0; let warningAtTick: number = HAZARD_RULES.initialDelayTicks;
  // Parameters are frozen at warning start; stage changes never truncate a warning or activation.
  for (;;) {
    const stage = difficultyAtTick(warningAtTick);
    const interval = stage === 3 ? DIFFICULTY_RULES.stage3IntervalTicks : stage === 2 ? DIFFICULTY_RULES.stage2IntervalTicks : HAZARD_RULES.intervalTicks;
    if (warningAtTick + interval > tick) break;
    warningAtTick += interval; cycle++;
  }
  const stage = difficultyAtTick(warningAtTick);
  const activeAtTick = warningAtTick + HAZARD_RULES.warningTicks;
  const endsAtTick = activeAtTick + (stage === 1 ? HAZARD_RULES.activeTicks : DIFFICULTY_RULES.movingActiveTicks);
  const phase = tick < warningAtTick || tick >= endsAtTick ? 'idle' : tick < activeAtTick ? 'warning' : 'active';
  if (stage === 1) return { id: `laser-${cycle + 1}`, ...patterns[cycle % patterns.length]!, stage, warningAtTick, activeAtTick, endsAtTick, phase };
  const axis = cycle % 2 === 0 ? 'y' : 'x';
  const direction = Math.floor(cycle / 2) % 2 === 0 ? 1 : -1;
  const bound = axis === 'x' ? ARENA.width : ARENA.height;
  const speed = stage === 2 ? DIFFICULTY_RULES.stage2Speed : DIFFICULTY_RULES.stage3Speed;
  const from = direction === 1 ? DIFFICULTY_RULES.margin : bound - DIFFICULTY_RULES.margin;
  const to = from + direction * speed * DIFFICULTY_RULES.movingActiveTicks / TICK_RATE;
  const coordinateAt = (time: number) => from + direction * speed * Math.max(0, Math.min(DIFFICULTY_RULES.movingActiveTicks, time - activeAtTick)) / TICK_RATE;
  const pattern = axis === 'x' ? (direction === 1 ? 'vertical-right' : 'vertical-left') : (direction === 1 ? 'horizontal-down' : 'horizontal-up');
  return { id: `laser-${cycle + 1}`, pattern, axis, coordinate: coordinateAt(tick), previousCoordinate: coordinateAt(Math.max(activeAtTick, tick - 1)),
    motion: { from, to, speed, direction }, stage, warningAtTick, activeAtTick, endsAtTick, phase };
}

export function laserCollision(laser: LaserState, position: Vector, previous: Vector = position) {
  const radius = ARENA.radius + HAZARD_RULES.halfWidth;
  // Relative swept motion prevents both player Dash and moving beams tunnelling.
  const start = previous[laser.axis] - (laser.previousCoordinate ?? laser.coordinate);
  const end = position[laser.axis] - laser.coordinate;
  return Math.min(start, end) <= radius && Math.max(start, end) >= -radius;
}
function respawnCollision(laser: LaserState, position: Vector) {
  if (!laser.motion) return laserCollision(laser, position);
  const radius = ARENA.radius + HAZARD_RULES.halfWidth;
  return position[laser.axis] >= Math.min(laser.motion.from, laser.motion.to) - radius && position[laser.axis] <= Math.max(laser.motion.from, laser.motion.to) + radius;
}
export function playerAlive(state: GameplayState, id: string) { return state.vitals.some(v => v.id === id && v.life === 'alive') && (!state.extraction || state.extraction.players.find(p => p.id === id)?.outcome === 'alive'); }
export function safeRespawnPosition(state: GameplayState, player: GameplayPlayer, players: GameplayPlayer[]): Vector {
  const origin = spawnPosition(player.slot);
  const cells = validCoreCells(players.filter(p => p.id !== player.id), state.cores).filter(p =>
    !players.some(other => other.id !== player.id && Math.hypot(other.position.x - p.x, other.position.y - p.y) <= ARENA.radius * 2) &&
    !state.hazards.some(h => h.phase !== 'idle' && respawnCollision(h, p)));
  cells.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) || a.y - b.y || a.x - b.x);
  // One bounded sweep corridor leaves safe cells; fallback is inside the body boundary.
  return { ...(cells[0] ?? origin) };
}
function event(state: GameplayState, player: GameplayPlayer, kind: HealthEvent['kind'], hazardId: string | null, health: number, amount = 0) {
  state.healthEvents.push({ sequence: state.nextEvent++, tick: state.tick, playerId: player.id, kind, hazardId, position: { ...player.position }, health, amount });
}
export function advanceHazards(state: GameplayState, players: GameplayPlayer[]) {
  if (state.match.phase !== 'ACTIVE') return;
  state.difficultyStage = difficultyAtTick(state.tick);
  const laser = laserAtTick(state.tick);
  if (state.hazards[0]?.id !== laser.id) state.hazardHits.clear();
  state.hazards = [laser];
  for (const player of [...players].sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))) {
    const vital = state.vitals.find(v => v.id === player.id);
    if (!vital || state.extraction?.players.find(p => p.id === player.id)?.outcome === 'extracted') continue;
    if (vital.life === 'respawning') {
      if (state.tick >= vital.respawnAtTick) {
        player.position = safeRespawnPosition(state, player, players);
        player.previousPosition = player.position;
        vital.respawnPosition = { ...player.position };
        vital.health = HAZARD_RULES.maxHealth; vital.life = 'alive'; vital.respawnAtTick = 0;
        vital.invulnerableUntilTick = state.tick + HAZARD_RULES.invulnerabilityTicks;
        event(state, player, 'respawn', null, vital.health);
      }
      continue;
    }
    if (!player.connected || laser.phase !== 'active' || state.hazardHits.has(player.id) || !laserCollision(laser, player.position, player.previousPosition)) continue;
    state.hazardHits.set(player.id, laser.id);
    const ability = state.abilities.find(a => a.id === player.id);
    if (state.tick < vital.invulnerableUntilTick) { event(state, player, 'invulnerable_blocked', laser.id, vital.health); continue; }
    if (ability && state.tick < ability.shieldUntilTick) { event(state, player, 'shield_blocked', laser.id, vital.health); continue; }
    const amount = Math.min(vital.health, HAZARD_RULES.damage);
    vital.health = Math.max(0, vital.health - amount);
    event(state, player, 'damage', laser.id, vital.health, amount);
    if (vital.health === 0) {
      vital.life = 'respawning'; vital.respawnAtTick = state.tick + HAZARD_RULES.respawnTicks;
      if (ability) { ability.dashUntilTick = Math.min(ability.dashUntilTick, state.tick); ability.shieldUntilTick = Math.min(ability.shieldUntilTick, state.tick); }
      const score = state.scores.find(s => s.id === player.id);
      if (score) { score.combo = 0; score.multiplier = 1; score.comboExpiresAtTick = 0; }
      event(state, player, 'death', laser.id, 0);
    }
  }
}
