import { HAZARD_RULES } from '@neon/protocol';
import type { HealthEvent, LaserState, Vector } from '@neon/protocol';
import { ARENA, spawnPosition } from './index.ts';
import { validCoreCells } from './gameplay.ts';
import type { GameplayPlayer, GameplayState } from './gameplay.ts';

const patterns = [{ axis: 'y', coordinate: 220 }, { axis: 'x', coordinate: 640 }, { axis: 'y', coordinate: 420 }, { axis: 'x', coordinate: 320 },
  { axis: 'y', coordinate: 100 }, { axis: 'x', coordinate: 800 }, { axis: 'y', coordinate: 540 }, { axis: 'x', coordinate: 160 }] as const;
export function laserAtTick(tick: number): LaserState {
  const cycle = Math.max(0, Math.floor((tick - HAZARD_RULES.initialDelayTicks) / HAZARD_RULES.intervalTicks));
  const pattern = patterns[cycle % patterns.length]!;
  const warningAtTick = HAZARD_RULES.initialDelayTicks + cycle * HAZARD_RULES.intervalTicks;
  const activeAtTick = warningAtTick + HAZARD_RULES.warningTicks;
  const endsAtTick = activeAtTick + HAZARD_RULES.activeTicks;
  return { id: `laser-${cycle + 1}`, ...pattern, warningAtTick, activeAtTick, endsAtTick,
    phase: tick < warningAtTick || tick >= endsAtTick ? 'idle' : tick < activeAtTick ? 'warning' : 'active' };
}

export function laserCollision(laser: LaserState, position: Vector, previous: Vector = position) {
  const radius = ARENA.radius + HAZARD_RULES.halfWidth;
  return Math.min(position[laser.axis], previous[laser.axis]) <= laser.coordinate + radius &&
    Math.max(position[laser.axis], previous[laser.axis]) >= laser.coordinate - radius;
}
export function playerAlive(state: GameplayState, id: string) { return state.vitals.some(v => v.id === id && v.life === 'alive'); }
export function safeRespawnPosition(state: GameplayState, player: GameplayPlayer, players: GameplayPlayer[]): Vector {
  const origin = spawnPosition(player.slot);
  const cells = validCoreCells(players.filter(p => p.id !== player.id), state.cores).filter(p =>
    !players.some(other => other.id !== player.id && Math.hypot(other.position.x - p.x, other.position.y - p.y) <= ARENA.radius * 2) &&
    !state.hazards.some(h => h.phase !== 'idle' && laserCollision(h, p)));
  cells.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) || a.y - b.y || a.x - b.x);
  // One full-arena line cannot cover all 384 cells; fallback is inside the body boundary.
  return { ...(cells[0] ?? origin) };
}
function event(state: GameplayState, player: GameplayPlayer, kind: HealthEvent['kind'], hazardId: string | null, health: number, amount = 0) {
  state.healthEvents.push({ sequence: state.nextEvent++, tick: state.tick, playerId: player.id, kind, hazardId, position: { ...player.position }, health, amount });
}
export function advanceHazards(state: GameplayState, players: GameplayPlayer[]) {
  const laser = laserAtTick(state.tick);
  if (state.hazards[0]?.id !== laser.id) state.hazardHits.clear();
  state.hazards = [laser];
  for (const player of [...players].sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))) {
    const vital = state.vitals.find(v => v.id === player.id);
    if (!vital) continue;
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
