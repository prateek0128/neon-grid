import { TICK_RATE } from '@neon/protocol';
import type { GameplaySnapshot } from '@neon/protocol';
export function ExtractionHud({ gameplay, playerId }: { gameplay: GameplaySnapshot | undefined; playerId: string | null }) {
  const state = gameplay?.extraction;
  if (!state || !gameplay) return null;
  const outcome = state.players.find(p => p.id === playerId)?.outcome;
  return <p className={`extraction-status ${state.phase === 'open' ? 'exit-open' : ''}`} role="status" data-testid="extraction-status" data-phase={state.phase} data-outcome={outcome ?? ''}>
    {outcome === 'extracted' ? 'Extracted · safe until results' : state.phase === 'lockdown' ? 'Lockdown resolved' : state.phase === 'open' ? `Extraction open · reach the teal zone · ${Math.ceil(state.remainingTicks / TICK_RATE)}s until lockdown` : `Extraction opens in ${Math.ceil((state.opensAtTick - gameplay.tick) / TICK_RATE)}s · teal zone at arena center`}
  </p>;
}
