import { TICK_RATE } from '@neon/protocol';
import type { LaserState, SweepPattern } from '@neon/protocol';
export const PATTERN_LABELS: Record<SweepPattern, string> = {
  'horizontal-up': 'Horizontal sweep · ↑ Up', 'horizontal-down': 'Horizontal sweep · ↓ Down',
  'vertical-left': 'Vertical sweep · ← Left', 'vertical-right': 'Vertical sweep · → Right',
};
// Presentation only: never advances a beam, chooses a pattern or decides damage.
export function hazardPresentation(hazard: LaserState | undefined, tick: number) {
  const phase = !hazard || (hazard.phase === 'idle' && tick < hazard.endsAtTick) ? 'pending' : hazard.phase === 'idle' ? 'complete' : hazard.phase;
  const name = hazard?.pattern ? PATTERN_LABELS[hazard.pattern] : hazard?.motion ? 'Moving sweep' : 'Static laser';
  const remaining = hazard && phase === 'warning' ? Math.max(0, hazard.activeAtTick - tick) / TICK_RATE : 0;
  const detail = phase === 'warning' ? `${hazard?.motion ? 'Sweep warning' : 'Laser warning'} · ${remaining.toFixed(1)}s · ${name} · ${hazard?.motion ? 'leave the amber corridor' : 'avoid the dashed line'}` :
    phase === 'active' ? `${name} · ACTIVE · red beam causes damage` : phase === 'complete' ? `${hazard?.motion ? 'Sweep' : 'Laser'} complete · beam off · next warning follows` : 'Security grid scanning · wait for the amber warning';
  return { phase, name, detail };
}
