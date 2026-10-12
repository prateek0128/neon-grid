import type { MatchResults, RoomMember } from '@neon/protocol';
import { TICK_RATE } from '@neon/protocol';
import { personalOutcome } from './round-presentation';
export function Results({ results, members, selfId }: { results: MatchResults; members: RoomMember[]; selfId: string }) {
  const name = (id: string) => members.find(m => m.id === id)?.displayName ?? `Player ${results.rankings.find(p => p.id === id)?.slot ?? ''}`;
  return <section className="match-results" data-testid="match-results" data-match-id={results.matchId} data-outcome={results.outcome}>
    <p className="eyebrow">RUN COMPLETE / FINAL RECORD</p>
    <p role="status" className="personal-outcome" data-testid="personal-outcome">{personalOutcome(results, selfId)}</p>
    <h2>{results.outcome === 'tie' ? 'Shared victory.' : results.outcome === 'winner' ? `${name(results.winnerIds[0]!)} takes the grid.` : 'Run complete.'}</h2>
    <p className="results-summary" data-testid="match-summary">{results.outcome === 'tie' ? `${results.winnerIds.map(name).join(' · ')} tied for first place.` : results.outcome === 'winner' ? 'Highest score wins this run.' : 'No players recorded.'} {Math.round(results.durationTicks / TICK_RATE)} seconds · {results.rankings.reduce((total, p) => total + p.coresCollected, 0)} cores collected.</p>
    <div className="results-table-wrap"><table aria-label="Final rankings"><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Cores</th><th>Outcome</th></tr></thead><tbody>
      {results.rankings.map(player => <tr key={player.id} className={player.id === selfId ? 'results-self' : ''} data-testid="result-player" data-player-id={player.id} data-rank={player.rank} data-score={player.score} data-cores={player.coresCollected} data-extraction={player.extractionOutcome ?? ""}>
        <td>{player.rank}</td><th scope="row">{name(player.id)}{player.id === selfId ? ' · YOU' : ''}</th><td>{player.score}</td><td>{player.coresCollected}</td><td>{player.extractionOutcome?.replaceAll("_", " ") ?? "—"}</td>
      </tr>)}
    </tbody></table></div>
    <p className="small">Final scores are locked. The host can launch another run or return the crew to the lobby.</p>
  </section>;
}
