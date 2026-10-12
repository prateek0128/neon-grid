import { TICK_RATE, type GameplaySnapshot, type MatchResults } from '@neon/protocol';
export function roundPresentation(gameplay?: GameplaySnapshot) {
  const seconds = gameplay?.match ? Math.max(0, Math.ceil((gameplay.match.durationTicks - gameplay.tick) / TICK_RATE)) : null;
  return { seconds, urgent: seconds !== null && seconds <= 10 && gameplay?.match?.phase === 'ACTIVE',
    label: seconds === null ? 'Connecting to the match…' : gameplay?.match?.phase === 'RESULTS' ? 'Run complete' : seconds <= 10 ? `LOCKDOWN IN ${seconds}s · reach extraction` : `${seconds}s remaining` };
}
export function personalOutcome(results: MatchResults, selfId: string) {
  const player = results.rankings.find(p => p.id === selfId);
  if (!player) return 'Run complete · spectating final results';
  const lead = player.rank === 1 ? results.outcome === 'tie' ? 'Shared victory' : 'Victory' : 'Run complete · outscored';
  return `${lead} · ${player.extractionOutcome === 'extracted' ? 'escaped the grid' : 'lockdown caught you'}`;
}
