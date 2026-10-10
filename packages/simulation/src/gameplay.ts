import { CORE_RULES } from '@neon/protocol';
import type { CoreState, GameplaySnapshot, PlayerState } from '@neon/protocol';
import { ARENA } from './index.ts';

export { CORE_RULES } from '@neon/protocol';
type Core = CoreState & { respawnAtTick: number };
export type GameplayState = Omit<GameplaySnapshot, 'cores'> & { cores: Core[]; nextCore: number; nextEvent: number };
export type GameplayPlayer = Pick<PlayerState, 'id' | 'slot' | 'position' | 'connected'>;

export function createGameplay(): GameplayState {
  return { tick: 0, cores: [], scores: [], events: [], nextCore: 1, nextEvent: 1 };
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
  const members = new Set(players.map(p => p.id));
  state.scores = state.scores.filter(s => members.has(s.id));
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
  state.tick++;
  for (const score of state.scores) if (score.combo && state.tick >= score.comboExpiresAtTick) {
    score.combo = 0; score.multiplier = 1; score.comboExpiresAtTick = 0;
  }
  // Stable slot order decides ties; each core is marked inactive before another can win it.
  const connected = players.filter(p => p.connected).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
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
    score.score += points; score.comboExpiresAtTick = state.tick + CORE_RULES.comboWindowTicks;
    state.events.push({ sequence: state.nextEvent++, tick: state.tick, coreId: core.id, playerId: winner.id,
      position: { ...core.position }, points, multiplier: score.multiplier });
  }
  state.events = state.events.slice(-CORE_RULES.eventLimit);
  for (let i = 0; i < state.cores.length; i++) if (!state.cores[i]!.active && state.tick >= state.cores[i]!.respawnAtTick) {
    const replacement = spawn(state, players, random);
    if (replacement) state.cores[i] = replacement;
  }
}

export function gameplaySnapshot(state: GameplayState): GameplaySnapshot {
  return { tick: state.tick, cores: state.cores.map(c => ({ id: c.id, position: { ...c.position }, active: c.active })),
    scores: state.scores.map(s => ({ ...s })), events: state.events.map(e => ({ ...e, position: { ...e.position } })) };
}
