export const PROTOCOL_VERSION = 1 as const;
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MAX_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 8192;
export const INPUT_TIMEOUT_MS = 250;
export const RECONNECT_GRACE_MS = 15000;
export const CORE_RULES = { cellSize: 40, count: 8, radius: 8, basePoints: 100, maxMultiplier: 3,
  comboWindowTicks: 5 * TICK_RATE, respawnTicks: 2 * TICK_RATE, eventLimit: 16 } as const;
export const ABILITY_RULES = { dashDurationTicks: 6, dashCooldownTicks: 5 * TICK_RATE, dashSpeedMultiplier: 3,
  directionMemoryMs: 1000, shieldDurationTicks: 2 * TICK_RATE, shieldCooldownTicks: 12 * TICK_RATE } as const;
export type AbilityKind = 'dash' | 'shield';
export const HAZARD_RULES = { maxHealth: 100, damage: 50, initialDelayTicks: 6 * TICK_RATE,
  warningTicks: 45, activeTicks: TICK_RATE, intervalTicks: 4 * TICK_RATE, halfWidth: 5,
  respawnTicks: 3 * TICK_RATE, invulnerabilityTicks: 45 } as const;

export const MATCH_RULES = { durationTicks: 90 * TICK_RATE } as const;
export type MatchRanking = { id: string; slot: number; rank: number; score: number; coresCollected: number };
export type MatchResults = { matchId: string; durationTicks: number; outcome: 'winner' | 'tie' | 'empty'; winnerIds: string[]; rankings: MatchRanking[] };
export type MatchState = { id: string; phase: 'ACTIVE' | 'RESULTS'; durationTicks: number; endedAtTick: number | null; results: MatchResults | null };
export type LifecycleRequest = { type: 'lifecycle'; version: 1; sessionId: string; sequence: number; matchId: string; action: 'replay' | 'return' };
export type LifecycleRejected = { type: 'lifecycle_rejected'; version: 1; reason: 'HOST_ONLY' | 'INVALID_TRANSITION' | 'STALE_MATCH' | 'NOT_READY' | 'BUSY' | 'ROOM_UNAVAILABLE' };
export type MatchComplete = { type: 'match_complete'; version: 1; results: MatchResults };

export type Vector = { x: number; y: number };
export * from './rooms.ts';
export type Authenticate = { type: 'authenticate'; version: 1; accessToken: string; roomId?: string; matchId?: string };
export type MovementInput = {
  type: 'input'; version: 1; sessionId: string; sequence: number; movement: Vector;
};
export type AbilityRequest = { type: 'ability'; version: 1; sessionId: string; sequence: number; ability: AbilityKind };
export type ClientMessage = Authenticate | MovementInput | AbilityRequest | LifecycleRequest;
export type PlayerState = {
  id: string; slot: number; position: Vector; connected: boolean; lastSequence: number;
};
export type CoreState = { id: string; position: Vector; active: boolean };
export type ScoreState = { id: string; score: number; combo: number; multiplier: number; comboExpiresAtTick: number };
export type CollectionEvent = { sequence: number; tick: number; coreId: string; playerId: string; position: Vector; points: number; multiplier: number };
export type AbilityState = { id: string; dashUntilTick: number; dashReadyAtTick: number; dashDirection: Vector;
  shieldUntilTick: number; shieldReadyAtTick: number };
export type AbilityEvent = { sequence: number; tick: number; playerId: string; ability: AbilityKind; position: Vector; direction: Vector };
export type LaserState = { id: string; axis: 'x' | 'y'; coordinate: number; phase: 'idle' | 'warning' | 'active'; warningAtTick: number; activeAtTick: number; endsAtTick: number };
export type PlayerVitals = { id: string; health: number; life: 'alive' | 'respawning'; respawnAtTick: number; invulnerableUntilTick: number; respawnPosition: Vector };
export type HealthEvent = { sequence: number; tick: number; playerId: string; kind: 'damage' | 'shield_blocked' | 'invulnerable_blocked' | 'death' | 'respawn'; hazardId: string | null; position: Vector; health: number; amount: number };
export type GameplaySnapshot = { tick: number; cores: CoreState[]; scores: ScoreState[]; events: CollectionEvent[];
  abilities?: AbilityState[]; abilityEvents?: AbilityEvent[]; hazards?: LaserState[]; vitals?: PlayerVitals[]; healthEvents?: HealthEvent[]; match?: MatchState };
export type Snapshot = { type: 'snapshot'; version: 1; epoch: string; tick: number; players: PlayerState[]; gameplay?: GameplaySnapshot };
export type ErrorCode = 'INVALID_MESSAGE' | 'AUTH_REQUIRED' | 'INVALID_SESSION' | 'AUTH_UNAVAILABLE' | 'SESSION_IN_USE' | 'ARENA_FULL' | 'STALE_SEQUENCE' | 'RATE_LIMITED' | 'SERVER_CLOSING' | 'ROOM_REQUIRED' | 'NOT_MEMBER' | 'MATCH_UNAVAILABLE' | 'ROOM_UNAVAILABLE';
export type ProtocolError = { type: 'error'; version: 1; code: ErrorCode; message: string };
export type Welcome = { type: 'welcome'; version: 1; playerId: string; sessionId: string; epoch: string; tickRate: number };
export type Authenticated = { type: 'authenticated'; version: 1 };
export type AbilityRejected = { type: 'ability_rejected'; version: 1; ability: AbilityKind; reason: 'COOLDOWN' | 'NO_DIRECTION' | 'DEAD' | 'MATCH_ENDED' };
export type ServerMessage = Snapshot | ProtocolError | Welcome | Authenticated | AbilityRejected | LifecycleRejected | MatchComplete;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.version !== PROTOCOL_VERSION) return null;
  const authKeys = value.roomId !== undefined || value.matchId !== undefined ? ['type', 'version', 'accessToken', 'roomId', 'matchId'] : ['type', 'version', 'accessToken'];
  if (value.type === 'authenticate' && exactKeys(value, authKeys) &&
      (authKeys.length === 3 || (identifier(value.roomId) && identifier(value.matchId))) &&
      typeof value.accessToken === 'string' && value.accessToken.length >= 20 && value.accessToken.length <= 4096) {
    return value as Authenticate;
  }
  if (value.type === 'lifecycle' && exactKeys(value, ['type', 'version', 'sessionId', 'sequence', 'matchId', 'action']) &&
      identifier(value.sessionId) && nonnegativeInteger(value.sequence) && identifier(value.matchId) && (value.action === 'replay' || value.action === 'return')) return value as LifecycleRequest;
  if (value.type === 'ability' && exactKeys(value, ['type', 'version', 'sessionId', 'sequence', 'ability']) &&
      identifier(value.sessionId) && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0 &&
      (value.ability === 'dash' || value.ability === 'shield')) return value as AbilityRequest;
  if (value.type !== 'input' || !exactKeys(value, ['type', 'version', 'sessionId', 'sequence', 'movement']) ||
      !identifier(value.sessionId) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
      !object(value.movement) || !exactKeys(value.movement, ['x', 'y']) ||
      !finite(value.movement.x) || !finite(value.movement.y) ||
      Math.abs(value.movement.x) > 1 || Math.abs(value.movement.y) > 1) return null;
  return value as MovementInput;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.version !== PROTOCOL_VERSION) return null;
  if (value.type === 'match_complete' && exactKeys(value, ['type', 'version', 'results']) && validResults(value.results)) return value as MatchComplete;
  if (value.type === 'lifecycle_rejected' && exactKeys(value, ['type', 'version', 'reason']) && typeof value.reason === 'string' &&
      ['HOST_ONLY', 'INVALID_TRANSITION', 'STALE_MATCH', 'NOT_READY', 'BUSY', 'ROOM_UNAVAILABLE'].includes(value.reason)) return value as LifecycleRejected;
  if (value.type === 'welcome' && identifier(value.playerId) && identifier(value.sessionId) && identifier(value.epoch) && value.tickRate === TICK_RATE) return value as Welcome;
  if (value.type === 'authenticated') return value as Authenticated;
  if (value.type === 'ability_rejected' && exactKeys(value, ['type', 'version', 'ability', 'reason']) &&
      (value.ability === 'dash' || value.ability === 'shield') && typeof value.reason === 'string' && ['COOLDOWN', 'NO_DIRECTION', 'DEAD', 'MATCH_ENDED'].includes(value.reason)) return value as AbilityRejected;
  if (value.type === 'error' && typeof value.code === 'string' && typeof value.message === 'string') return value as ProtocolError;
  if (value.type !== 'snapshot' || !identifier(value.epoch) || !Number.isSafeInteger(value.tick) || (value.tick as number) < 0 ||
      !Array.isArray(value.players) || value.players.length > MAX_PLAYERS) return null;
  const ids = new Set<string>();
  const slots = new Set<number>();
  for (const player of value.players) {
    if (!object(player) || !identifier(player.id) || ids.has(player.id) || !Number.isInteger(player.slot) ||
        (player.slot as number) < 1 || (player.slot as number) > MAX_PLAYERS || slots.has(player.slot as number) ||
        !object(player.position) || !finite(player.position.x) || !finite(player.position.y) ||
        typeof player.connected !== 'boolean' || !Number.isSafeInteger(player.lastSequence) || (player.lastSequence as number) < -1) return null;
    ids.add(player.id);
    slots.add(player.slot as number);
  }
  if (value.gameplay !== undefined && !validGameplay(value.gameplay)) return null;
  return value as Snapshot;
}

function nonnegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function validGameplay(value: unknown): value is GameplaySnapshot {
  if (!object(value) || !nonnegativeInteger(value.tick) || !Array.isArray(value.cores) || value.cores.length > CORE_RULES.count ||
      !Array.isArray(value.scores) || value.scores.length > MAX_PLAYERS || !Array.isArray(value.events) || value.events.length > CORE_RULES.eventLimit) return false;
  if (value.match !== undefined && !validMatch(value.match, value.tick)) return false;
  const position = (p: unknown) => object(p) && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 960 && p.y >= 0 && p.y <= 640;
  const coreId = (id: unknown) => typeof id === 'string' && /^core-[1-9]\d{0,14}$/.test(id);
  const multiplier = (m: unknown) => Number.isInteger(m) && (m as number) >= 1 && (m as number) <= CORE_RULES.maxMultiplier;
  const coreIds = new Set<string>();
  for (const core of value.cores) {
    if (!object(core) || !coreId(core.id) || coreIds.has(core.id as string) || !position(core.position) || typeof core.active !== 'boolean') return false;
    coreIds.add(core.id as string);
  }
  const scoreIds = new Set<string>();
  for (const score of value.scores) {
    if (!object(score) || !identifier(score.id) || scoreIds.has(score.id) || !nonnegativeInteger(score.score) ||
        !nonnegativeInteger(score.combo) || !multiplier(score.multiplier) || !nonnegativeInteger(score.comboExpiresAtTick)) return false;
    scoreIds.add(score.id);
  }
  let sequence = 0;
  for (const event of value.events) {
    if (!object(event) || !nonnegativeInteger(event.sequence) || event.sequence <= sequence || !nonnegativeInteger(event.tick) || event.tick > value.tick ||
        !coreId(event.coreId) || !identifier(event.playerId) || !position(event.position) || !multiplier(event.multiplier) || event.points !== CORE_RULES.basePoints * (event.multiplier as number)) return false;
    sequence = event.sequence;
  }
  if (value.abilities !== undefined) {
    if (!Array.isArray(value.abilities) || value.abilities.length > MAX_PLAYERS || !Array.isArray(value.abilityEvents) ||
        value.abilityEvents.length + value.events.length > CORE_RULES.eventLimit) return false;
    const abilityIds = new Set<string>();
    const direction = (d: unknown) => object(d) && finite(d.x) && finite(d.y) && Math.hypot(d.x, d.y) <= 1.000001;
    for (const ability of value.abilities) {
      if (!object(ability) || !identifier(ability.id) || abilityIds.has(ability.id) || !scoreIds.has(ability.id) ||
          !nonnegativeInteger(ability.dashUntilTick) || !nonnegativeInteger(ability.dashReadyAtTick) ||
          !nonnegativeInteger(ability.shieldUntilTick) || !nonnegativeInteger(ability.shieldReadyAtTick) ||
          ability.dashUntilTick > ability.dashReadyAtTick || ability.shieldUntilTick > ability.shieldReadyAtTick || !direction(ability.dashDirection)) return false;
      abilityIds.add(ability.id);
    }
    const sequences = new Set(value.events.map(e => (e as CollectionEvent).sequence));
    let previous = 0;
    for (const event of value.abilityEvents) {
      if (!object(event) || !nonnegativeInteger(event.sequence) || event.sequence <= previous || sequences.has(event.sequence) ||
          !nonnegativeInteger(event.tick) || event.tick > value.tick || !identifier(event.playerId) ||
          (event.ability !== 'dash' && event.ability !== 'shield') || !position(event.position) || !direction(event.direction)) return false;
      previous = event.sequence;
    }
  } else if (value.abilityEvents !== undefined) return false;
  if (value.vitals !== undefined) {
    if (!Array.isArray(value.vitals) || value.vitals.length > MAX_PLAYERS || !Array.isArray(value.hazards) || value.hazards.length > 1 || !Array.isArray(value.healthEvents) ||
        value.healthEvents.length + value.events.length + (Array.isArray(value.abilityEvents) ? value.abilityEvents.length : 0) > CORE_RULES.eventLimit) return false;
    const vitalIds = new Set<string>();
    for (const vital of value.vitals) {
      if (!object(vital) || !identifier(vital.id) || vitalIds.has(vital.id) || !scoreIds.has(vital.id) || !nonnegativeInteger(vital.health) || vital.health > HAZARD_RULES.maxHealth ||
          (vital.life !== 'alive' && vital.life !== 'respawning') || (vital.life === 'respawning' ? vital.health !== 0 : vital.health === 0) ||
          !nonnegativeInteger(vital.respawnAtTick) || (vital.life === 'respawning' ? vital.respawnAtTick <= value.tick : vital.respawnAtTick !== 0) ||
          !nonnegativeInteger(vital.invulnerableUntilTick) || !position(vital.respawnPosition)) return false;
      vitalIds.add(vital.id);
    }
    const laserId = (id: unknown) => typeof id === 'string' && /^laser-[1-9]\d{0,14}$/.test(id);
    for (const laser of value.hazards) {
      if (!object(laser) || !laserId(laser.id) || (laser.axis !== 'x' && laser.axis !== 'y') || !finite(laser.coordinate) || laser.coordinate < 0 ||
          laser.coordinate > (laser.axis === 'x' ? 960 : 640) || !nonnegativeInteger(laser.warningAtTick) || !nonnegativeInteger(laser.activeAtTick) || !nonnegativeInteger(laser.endsAtTick) ||
          laser.activeAtTick - laser.warningAtTick !== HAZARD_RULES.warningTicks || laser.endsAtTick - laser.activeAtTick !== HAZARD_RULES.activeTicks) return false;
      const phase = value.tick < laser.warningAtTick || value.tick >= laser.endsAtTick ? 'idle' : value.tick < laser.activeAtTick ? 'warning' : 'active';
      if (laser.phase !== phase) return false;
    }
    const sequences = new Set([...value.events, ...(Array.isArray(value.abilityEvents) ? value.abilityEvents : [])].map(e => (e as CollectionEvent).sequence));
    let previous = 0;
    for (const event of value.healthEvents) {
      if (!object(event) || !nonnegativeInteger(event.sequence) || event.sequence <= previous || sequences.has(event.sequence) || !nonnegativeInteger(event.tick) || event.tick > value.tick ||
          !identifier(event.playerId) || typeof event.kind !== 'string' || !['damage', 'shield_blocked', 'invulnerable_blocked', 'death', 'respawn'].includes(event.kind) ||
          (event.hazardId !== null && !laserId(event.hazardId)) || !position(event.position) || !nonnegativeInteger(event.health) || event.health > HAZARD_RULES.maxHealth ||
          !nonnegativeInteger(event.amount) || event.amount > HAZARD_RULES.damage || (event.kind !== 'damage' && event.amount !== 0)) return false;
      previous = event.sequence;
    }
  } else if (value.hazards !== undefined || value.healthEvents !== undefined) return false;
  return true;
}

function validResults(value: unknown): value is MatchResults {
  if (!object(value) || !identifier(value.matchId) || !nonnegativeInteger(value.durationTicks) || value.durationTicks < 1 ||
      !Array.isArray(value.rankings) || value.rankings.length > MAX_PLAYERS || !Array.isArray(value.winnerIds)) return false;
  const ids = new Set<string>(); let previousScore = Infinity; let previousRank = 0;
  for (let i = 0; i < value.rankings.length; i++) {
    const row = value.rankings[i];
    if (!object(row) || !identifier(row.id) || ids.has(row.id) || !Number.isInteger(row.slot) || (row.slot as number) < 1 || (row.slot as number) > 4 ||
        !nonnegativeInteger(row.score) || row.score > previousScore || !nonnegativeInteger(row.coresCollected) ||
        row.rank !== (row.score === previousScore ? previousRank : i + 1)) return false;
    ids.add(row.id); previousScore = row.score; previousRank = row.rank as number;
  }
  const winners = value.rankings.filter(row => (row as MatchRanking).rank === 1).map(row => (row as MatchRanking).id);
  return value.winnerIds.length === winners.length && value.winnerIds.every((id, i) => id === winners[i]) &&
    value.outcome === (winners.length === 0 ? 'empty' : winners.length === 1 ? 'winner' : 'tie');
}
function validMatch(value: unknown, tick: number): value is MatchState {
  if (!object(value) || !identifier(value.id) || !nonnegativeInteger(value.durationTicks) || value.durationTicks < 1) return false;
  if (value.phase === 'ACTIVE') return tick < value.durationTicks && value.endedAtTick === null && value.results === null;
  return value.phase === 'RESULTS' && value.endedAtTick === tick && tick >= value.durationTicks && validResults(value.results) &&
    value.results.matchId === value.id && value.results.durationTicks === tick;
}

export * from './configuration.ts';
