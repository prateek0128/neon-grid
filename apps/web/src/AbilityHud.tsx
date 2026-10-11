import { TICK_RATE } from '@neon/protocol';
import type { AbilityKind, GameplaySnapshot } from '@neon/protocol';

export function AbilityHud({ gameplay, playerId, connected, notice, onActivate }: {
  gameplay: GameplaySnapshot | undefined; playerId: string | null; connected: boolean;
  notice: string | undefined; onActivate: (ability: AbilityKind) => void;
}) {
  const state = gameplay?.abilities?.find(a => a.id === playerId);
  const tick = gameplay?.tick ?? 0;
  const alive = gameplay?.match?.phase !== 'RESULTS' && gameplay?.vitals?.find(v => v.id === playerId)?.life !== 'respawning';
  const dashCooldown = state ? Math.max(0, Math.ceil((state.dashReadyAtTick - tick) / TICK_RATE)) : 0;
  const shieldCooldown = state ? Math.max(0, Math.ceil((state.shieldReadyAtTick - tick) / TICK_RATE)) : 0;
  const shieldActive = !!state && tick < state.shieldUntilTick;
  return <div className="ability-hud" data-testid="ability-hud" data-shield-active={shieldActive} data-dash-active={!!state && tick < state.dashUntilTick}
    data-dash-cooldown={dashCooldown} data-shield-cooldown={shieldCooldown}>
    <div className="ability-controls">
      <button disabled={!connected || !state || !alive || dashCooldown > 0} onClick={() => onActivate('dash')}>Dash · Space · {dashCooldown ? `${dashCooldown}s` : 'Ready'}</button>
      <button className="secondary" disabled={!connected || !state || !alive || shieldCooldown > 0} onClick={() => onActivate('shield')}>Shield · E · {shieldCooldown ? `${shieldCooldown}s` : 'Ready'}</button>
    </div>
    <p className="small" role="status">{!alive ? 'Respawning · movement and abilities paused' : notice || (shieldActive ? 'Shield active' : 'Dash follows your recent movement direction. Shield lasts 2 seconds.')}</p>
  </div>;
}
