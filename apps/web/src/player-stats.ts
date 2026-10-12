import type { MatchResults } from '@neon/protocol';
export type PlayerStats = { wins: number; losses: number; highestScore: number; coresCollected: number; personalBest: number; recordedMatches: string[] };
const key = 'neon-grid-player-stats-v1';
export function loadStats(): PlayerStats {
  try { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); if (Array.isArray(value.recordedMatches)) return { wins: Number(value.wins) || 0, losses: Number(value.losses) || 0, highestScore: Number(value.highestScore) || 0, coresCollected: Number(value.coresCollected) || 0, personalBest: Number(value.personalBest) || 0, recordedMatches: value.recordedMatches.filter((id: unknown) => typeof id === 'string').slice(-100) }; } catch { /* Use default. */ }
  return { wins: 0, losses: 0, highestScore: 0, coresCollected: 0, personalBest: 0, recordedMatches: [] };
}
export function recordAuthoritativeResult(results: MatchResults, selfId: string): PlayerStats {
  const previous = loadStats(); const player = results.rankings.find(value => value.id === selfId);
  if (!player || previous.recordedMatches.includes(results.matchId)) return previous;
  const win = player.rank === 1;
  const next = { ...previous, wins: previous.wins + Number(win), losses: previous.losses + Number(!win), highestScore: Math.max(previous.highestScore, player.score), personalBest: Math.max(previous.personalBest, player.score), coresCollected: previous.coresCollected + player.coresCollected, recordedMatches: [...previous.recordedMatches, results.matchId].slice(-100) };
  localStorage.setItem(key, JSON.stringify(next)); return next;
}
