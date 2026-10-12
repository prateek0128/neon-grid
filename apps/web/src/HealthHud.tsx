import { hazardPresentation } from './hazard-presentation';
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
  const presentation = hazardPresentation(hazard, gameplay?.tick ?? 0);
  return <div className="health-hud">
    <HealthBadge vital={vital} tick={gameplay?.tick ?? 0} />
    <p className={`hazard-status ${presentation.phase}`} role="status" data-testid="hazard-status" data-presentation={presentation.phase} data-pattern={hazard?.pattern ?? "static"} data-stage={gameplay?.difficultyStage ?? 1} data-coordinate={hazard?.coordinate ?? ''} data-moving={!!hazard?.motion} data-phase={hazard?.phase ?? 'idle'} data-hazard-id={hazard?.id ?? ''}>
      {presentation.detail}
    </p>
    <p className="hazard-legend">Amber dashed = warning · Red solid = damage · Corridor arrows show direction</p>
    <p className="small" data-testid="difficulty-stage">Security pressure · stage {gameplay?.difficultyStage ?? 1}/3</p>
    <p className="damage-notice" role="status" data-testid="damage-notice">{recent ? recent.kind === 'damage' ? `Hit · −${recent.amount} HP` : recent.kind === 'shield_blocked' ? 'Shield blocked the laser' : recent.kind === 'invulnerable_blocked' ? 'Respawn protection blocked the laser' : recent.kind === 'death' ? 'Down · respawning shortly' : 'Respawned · temporary protection' : 'Warnings mark the next laser. Shield blocks its hit.'}</p>
  </div>;
}
