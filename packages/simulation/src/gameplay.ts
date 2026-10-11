import { CORE_RULES, HAZARD_RULES, MATCH_RULES, EXTRACTION_RULES } from '@neon/protocol';
import type { AbilityEvent, AbilityState, CoreState, GameplaySnapshot, HealthEvent, LaserState, PlayerState, PlayerVitals, Vector, MatchState, MatchRanking } from '@neon/protocol';
import { ARENA, spawnPosition } from './index.ts';
import { advanceHazards, laserAtTick, playerAlive } from './hazards.ts';

export { CORE_RULES } from '@neon/protocol';
type Core = CoreState & { respawnAtTick: number };
export type GameplayState = Omit<GameplaySnapshot, 'cores' | 'abilities' | 'abilityEvents' | 'vitals' | 'hazards' | 'healthEvents' | 'match'> & {
  cores: Core[]; abilities: AbilityState[]; abilityEvents: AbilityEvent[]; vitals: PlayerVitals[]; hazards: LaserState[];
  match: MatchState; participants: Map<string, Omit<MatchRanking, 'rank'>>; healthEvents: HealthEvent[]; hazardHits: Map<string, string>; nextCore: number; nextEvent: number };
export type GameplayPlayer = Pick<PlayerState, 'id' | 'slot' | 'position' | 'connected'> & { previousPosition?: Vector };

export function createGameplay(durationTicks: number = MATCH_RULES.durationTicks, generationId: string = crypto.randomUUID(), extractionWindowTicks: number = EXTRACTION_RULES.windowTicks): GameplayState {
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 1) throw new Error('Match duration must be a positive number of ticks.');
  if (!Number.isSafeInteger(extractionWindowTicks) || extractionWindowTicks < 1) throw new Error('Extraction window must be positive ticks.');
  return { extraction: { phase: durationTicks <= extractionWindowTicks ? 'open' : 'closed', opensAtTick: Math.max(0, durationTicks - extractionWindowTicks), closesAtTick: durationTicks, remainingTicks: durationTicks, zone: { ...EXTRACTION_RULES.zone }, players: [] }, match: { id: generationId, phase: 'ACTIVE', durationTicks, endedAtTick: null, results: null }, participants: new Map(), tick: 0, cores: [], scores: [], events: [], abilities: [], abilityEvents: [], vitals: [], hazards: [laserAtTick(0)], healthEvents: [], hazardHits: new Map(), nextCore: 1, nextEvent: 1 };
}

// The arena has no interior walls. Cell centers are inside its solid boundary.
export function validCoreCells(players: GameplayPlayer[], cores: CoreState[]) {
  const cells = [];
  const cell = CORE_RULES.cellSize;
  for (let y = cell / 2; y < ARENA.height; y += cell) for (let x = cell / 2; x < ARENA.width; x += cell) {
    if (players.some(p => (Math.floor(p.position.x / cell) === Math.floor(x / cell) && Math.floor(p.position.y / cell) === Math.floor(y / cell)) ||
      Math.hypot(p.position.x - x, p.position.y - y) <= ARENA.radius + CORE_RULES.radius)) continue;
    if (cores.some(c => c.position.x === x && c.position.y === y)) continue;
    cells.push({ x, y });
  }
  return cells;
}

function spawn(state: GameplayState, players: GameplayPlayer[], random: () => number): Core | null {
  const cells = validCoreCells(players, state.cores);
  if (!cells.length) return null;
  const choice = Math.min(cells.length - 1, Math.max(0, Math.floor(random() * cells.length)));
  return { id: `core-${state.nextCore++}`, position: cells[choice]!, active: true, respawnAtTick: 0 };
}

export function reconcileGameplay(state: GameplayState, players: GameplayPlayer[], random: () => number = Math.random) {
  if (state.match.phase === 'RESULTS') return;
  for (const player of players) if (!state.extraction!.players.some(p => p.id === player.id)) state.extraction!.players.push({ id: player.id, outcome: 'alive', extractedAtTick: null });
  for (const player of players) if (!state.participants.has(player.id)) state.participants.set(player.id, { id: player.id, slot: player.slot, score: 0, coresCollected: 0 });
  const members = new Set(players.map(p => p.id));
  state.scores = state.scores.filter(s => members.has(s.id));
  state.abilities = state.abilities.filter(s => members.has(s.id));
  state.vitals = state.vitals.filter(s => members.has(s.id));
  for (const id of state.hazardHits.keys()) if (!members.has(id)) state.hazardHits.delete(id);
  for (const player of players) if (!state.vitals.some(v => v.id === player.id)) {
    state.vitals.push({ id: player.id, health: HAZARD_RULES.maxHealth, life: 'alive', respawnAtTick: 0, invulnerableUntilTick: 0, respawnPosition: spawnPosition(player.slot) });
  }
  for (const player of players) if (!state.abilities.some(s => s.id === player.id)) {
    state.abilities.push({ id: player.id, dashUntilTick: 0, dashReadyAtTick: 0, dashDirection: { x: 0, y: 0 }, shieldUntilTick: 0, shieldReadyAtTick: 0 });
  }
  for (const player of [...players].sort((a, b) => a.slot - b.slot)) if (!state.scores.some(s => s.id === player.id)) {
    state.scores.push({ id: player.id, score: 0, combo: 0, multiplier: 1, comboExpiresAtTick: 0 });
  }
  while (state.cores.length < CORE_RULES.count) {
    const core = spawn(state, players, random);
    if (!core) break;
    state.cores.push(core);
  }
}

export function advanceGameplay(state: GameplayState, players: GameplayPlayer[], random: () => number = Math.random) {
  if (state.match.phase !== 'ACTIVE') return;
  state.tick++;
  advanceHazards(state, players);
  for (const score of state.scores) if (score.combo && state.tick >= score.comboExpiresAtTick) {
    score.combo = 0; score.multiplier = 1; score.comboExpiresAtTick = 0;
  }
  // Stable slot order decides ties; each core is marked inactive before another can win it.
  const connected = players.filter(p => p.connected && playerAlive(state, p.id)).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
  for (const core of state.cores) {
    if (!core.active) continue;
    const winner = connected.find(p => state.scores.some(s => s.id === p.id) &&
      Math.hypot(p.position.x - core.position.x, p.position.y - core.position.y) <= ARENA.radius + CORE_RULES.radius);
    if (!winner) continue;
    core.active = false; core.respawnAtTick = state.tick + CORE_RULES.respawnTicks;
    const score = state.scores.find(s => s.id === winner.id)!;
    score.combo++;
    score.multiplier = Math.min(score.combo, CORE_RULES.maxMultiplier);
    const points = CORE_RULES.basePoints * score.multiplier;
    const participant = state.participants.get(winner.id)!; participant.score += points; participant.coresCollected++;
    score.score += points; score.comboExpiresAtTick = state.tick + CORE_RULES.comboWindowTicks;
    state.events.push({ sequence: state.nextEvent++, tick: state.tick, coreId: core.id, playerId: winner.id,
      position: { ...core.position }, points, multiplier: score.multiplier });
  }
  pruneGameplayEvents(state);
  for (let i = 0; i < state.cores.length; i++) if (!state.cores[i]!.active && state.tick >= state.cores[i]!.respawnAtTick) {
    const replacement = spawn(state, players, random);
    if (replacement) state.cores[i] = replacement;
  }
  const extraction = state.extraction!;
  extraction.remainingTicks = Math.max(0, extraction.closesAtTick - state.tick);
  extraction.phase = state.tick >= extraction.opensAtTick ? 'open' : 'closed';
  if (extraction.phase === 'open') for (const player of connected) {
    const outcome = extraction.players.find(p => p.id === player.id);
    if (outcome?.outcome === 'alive' && Math.hypot(player.position.x - extraction.zone.x, player.position.y - extraction.zone.y) <= extraction.zone.radius) {
      outcome.outcome = 'extracted'; outcome.extractedAtTick = state.tick;
      const ability = state.abilities.find(a => a.id === player.id);
      if (ability) { ability.dashUntilTick = Math.min(ability.dashUntilTick, state.tick); ability.shieldUntilTick = Math.min(ability.shieldUntilTick, state.tick); }
    }
  }
  if (state.tick >= state.match.durationTicks) {
    extraction.phase = 'lockdown';
    for (const outcome of extraction.players) if (outcome.outcome === 'alive') outcome.outcome = state.vitals.find(v => v.id === outcome.id)?.life === 'respawning' ? 'dead' : 'locked_down';
    finalizeGameplay(state);
  }
}

export function gameplaySnapshot(state: GameplayState): GameplaySnapshot {
  return { extraction: structuredClone(state.extraction), match: structuredClone(state.match), tick: state.tick, cores: state.cores.map(c => ({ id: c.id, position: { ...c.position }, active: c.active })),
    scores: state.scores.map(s => ({ ...s })), events: state.events.map(e => ({ ...e, position: { ...e.position } })),
    abilities: state.abilities.map(a => ({ ...a, dashDirection: { ...a.dashDirection } })),
    abilityEvents: state.abilityEvents.map(e => ({ ...e, position: { ...e.position }, direction: { ...e.direction } })),
    vitals: state.vitals.map(v => ({ ...v, respawnPosition: { ...v.respawnPosition } })), hazards: state.hazards.map(h => ({ ...h })),
    healthEvents: state.healthEvents.map(e => ({ ...e, position: { ...e.position } })) };
}

export function pruneGameplayEvents(state: GameplayState) {
  const oldest = state.nextEvent - CORE_RULES.eventLimit;
  state.events = state.events.filter(e => e.sequence >= oldest);
  state.abilityEvents = state.abilityEvents.filter(e => e.sequence >= oldest);
  state.healthEvents = state.healthEvents.filter(e => e.sequence >= oldest);
}

export function finalizeGameplay(state: GameplayState): boolean {
  if (state.match.phase !== 'ACTIVE' || state.tick < state.match.durationTicks) return false;
  const ordered = [...state.participants.values()].sort((a, b) => b.score - a.score || a.slot - b.slot || a.id.localeCompare(b.id));
  let previousScore = -1; let rank = 0;
  const rankings = ordered.map((player, index) => { if (player.score !== previousScore) rank = index + 1; previousScore = player.score; return { ...player, rank, extractionOutcome: state.extraction?.players.find(p => p.id === player.id)?.outcome }; });
  const winnerIds = rankings.filter(p => p.rank === 1).map(p => p.id);
  state.match.phase = 'RESULTS'; state.match.endedAtTick = state.tick;
  state.match.results = { matchId: state.match.id, durationTicks: state.tick, rankings, winnerIds, outcome: !winnerIds.length ? 'empty' : winnerIds.length === 1 ? 'winner' : 'tie' };
  return true;
}
