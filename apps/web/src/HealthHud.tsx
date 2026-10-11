import { HAZARD_RULES, TICK_RATE } from '@neon/protocol';
import type { GameplaySnapshot, PlayerVitals } from '@neon/protocol';

export function HealthBadge({ vital, tick }: { vital: PlayerVitals | undefined; tick: number }) {
  if (!vital) return null;
  const respawnSeconds = Math.max(0, Math.ceil((vital.respawnAtTick - tick) / TICK_RATE));
  const protectedSeconds = Math.max(0, Math.ceil((vital.invulnerableUntilTick - tick) / TICK_RATE));
  return <div className={`health-badge ${vital.life === 'respawning' ? 'respawning' : ''}`} data-testid="health" data-member-id={vital.id}
    data-health={vital.health} data-life={vital.life} data-invulnerable={protectedSeconds > 0}>
    <meter min={0} max={HAZARD_RULES.maxHealth} value={vital.health} aria-label="Player health" />
    <span>{vital.health}/{HAZARD_RULES.maxHealth} HP · {vital.life === 'respawning' ? `Respawn in ${respawnSeconds}s` : protectedSeconds ? `Protected · ${protectedSeconds}s` : 'Alive'}</span>
  </div>;
}

export function HealthHud({ gameplay, playerId }: { gameplay: GameplaySnapshot | undefined; playerId: string | null }) {
  const vital = gameplay?.vitals?.find(v => v.id === playerId);
  const event = gameplay?.healthEvents?.findLast(e => e.playerId === playerId);
  const recent = event && gameplay && gameplay.tick - event.tick < TICK_RATE * 2 ? event : null;
  const hazard = gameplay?.hazards?.[0];
  return <div className="health-hud">
    <HealthBadge vital={vital} tick={gameplay?.tick ?? 0} />
    <p className={`hazard-status ${hazard?.phase ?? ''}`} role="status" data-testid="hazard-status" data-phase={hazard?.phase ?? 'idle'} data-hazard-id={hazard?.id ?? ''}>
      {hazard?.phase === 'warning' ? `Laser warning · ${Math.max(1, Math.ceil((hazard.activeAtTick - (gameplay?.tick ?? 0)) / TICK_RATE))}s` : hazard?.phase === 'active' ? 'Laser active · avoid the red beam' : 'Security grid scanning'}
    </p>
    <p className="damage-notice" role="status" data-testid="damage-notice">{recent ? recent.kind === 'damage' ? `Hit · −${recent.amount} HP` : recent.kind === 'shield_blocked' ? 'Shield blocked the laser' : recent.kind === 'invulnerable_blocked' ? 'Respawn protection blocked the laser' : recent.kind === 'death' ? 'Down · respawning shortly' : 'Respawned · temporary protection' : 'Warnings mark the next laser. Shield blocks its hit.'}</p>
  </div>;
}
