import { ABILITY_RULES, TICK_RATE } from '@neon/protocol';
import type { AbilityKind, Vector } from '@neon/protocol';
import { advancePosition, normalizeMovement } from './index.ts';
import { pruneGameplayEvents } from './gameplay.ts';
import type { GameplayState } from './gameplay.ts';
import { playerAlive } from './hazards.ts';

export function activateAbility(state: GameplayState, playerId: string, ability: AbilityKind, position: Vector, direction: Vector | null): 'COOLDOWN' | 'NO_DIRECTION' | 'NOT_MEMBER' | 'DEAD' | 'EXTRACTED' | 'MATCH_ENDED' | null {
  if (state.match.phase !== 'ACTIVE') return 'MATCH_ENDED';
  if (state.extraction?.players.find(p => p.id === playerId)?.outcome === 'extracted') return 'EXTRACTED';
  const current = state.abilities.find(a => a.id === playerId);
  if (!current) return 'NOT_MEMBER';
  if (state.match.phase !== 'ACTIVE' || !playerAlive(state, playerId)) return 'DEAD';
  if (ability === 'dash') {
    if (state.tick < current.dashReadyAtTick) return 'COOLDOWN';
    if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y) ||
        Math.abs(direction.x) > 1 || Math.abs(direction.y) > 1 || Math.hypot(direction.x, direction.y) === 0) return 'NO_DIRECTION';
    const length = Math.hypot(direction.x, direction.y);
    current.dashDirection = { x: direction.x / length, y: direction.y / length };
    current.dashUntilTick = state.tick + ABILITY_RULES.dashDurationTicks;
    current.dashReadyAtTick = state.tick + ABILITY_RULES.dashCooldownTicks;
  } else {
    if (state.tick < current.shieldReadyAtTick) return 'COOLDOWN';
    current.shieldUntilTick = state.tick + ABILITY_RULES.shieldDurationTicks;
    current.shieldReadyAtTick = state.tick + ABILITY_RULES.shieldCooldownTicks;
  }
  state.abilityEvents.push({ sequence: state.nextEvent++, tick: state.tick, playerId, ability, position: { ...position },
    direction: ability === 'dash' ? { ...current.dashDirection } : { x: 0, y: 0 } });
  pruneGameplayEvents(state);
  return null;
}

export function advanceAbilityPosition(state: GameplayState, playerId: string, position: Vector, movement: Vector) {
  if (state.match.phase !== 'ACTIVE' || !playerAlive(state, playerId)) return { ...position };
  const ability = state.abilities.find(a => a.id === playerId);
  const dashing = ability && state.tick < ability.dashUntilTick;
  const direction = dashing ? ability.dashDirection : normalizeMovement(movement);
  // Six normal fixed steps with a speed multiplier, retaining the same solid-boundary clamp.
  return advancePosition(position, direction, (dashing ? ABILITY_RULES.dashSpeedMultiplier : 1) / TICK_RATE);
}

export function cancelDash(state: GameplayState, playerId: string) {
  if (state.match.phase !== 'ACTIVE') return;
  const ability = state.abilities.find(a => a.id === playerId);
  if (ability) ability.dashUntilTick = Math.min(ability.dashUntilTick, state.tick);
}
