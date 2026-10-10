export const PROTOCOL_VERSION = 1 as const;
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MAX_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 8192;
export const INPUT_TIMEOUT_MS = 250;
export const RECONNECT_GRACE_MS = 15000;
export const CORE_RULES = { cellSize: 40, count: 8, radius: 8, basePoints: 100, maxMultiplier: 3,
  comboWindowTicks: 5 * TICK_RATE, respawnTicks: 2 * TICK_RATE, eventLimit: 16 } as const;

export type Vector = { x: number; y: number };
export * from './rooms.ts';
export type Authenticate = { type: 'authenticate'; version: 1; accessToken: string; roomId?: string; matchId?: string };
export type MovementInput = {
  type: 'input'; version: 1; sessionId: string; sequence: number; movement: Vector;
};
export type ClientMessage = Authenticate | MovementInput;
export type PlayerState = {
  id: string; slot: number; position: Vector; connected: boolean; lastSequence: number;
};
export type CoreState = { id: string; position: Vector; active: boolean };
export type ScoreState = { id: string; score: number; combo: number; multiplier: number; comboExpiresAtTick: number };
export type CollectionEvent = { sequence: number; tick: number; coreId: string; playerId: string; position: Vector; points: number; multiplier: number };
export type GameplaySnapshot = { tick: number; cores: CoreState[]; scores: ScoreState[]; events: CollectionEvent[] };
export type Snapshot = { type: 'snapshot'; version: 1; epoch: string; tick: number; players: PlayerState[]; gameplay?: GameplaySnapshot };
export type ErrorCode = 'INVALID_MESSAGE' | 'AUTH_REQUIRED' | 'INVALID_SESSION' | 'AUTH_UNAVAILABLE' | 'SESSION_IN_USE' | 'ARENA_FULL' | 'STALE_SEQUENCE' | 'RATE_LIMITED' | 'SERVER_CLOSING' | 'ROOM_REQUIRED' | 'NOT_MEMBER' | 'MATCH_UNAVAILABLE' | 'ROOM_UNAVAILABLE';
export type ProtocolError = { type: 'error'; version: 1; code: ErrorCode; message: string };
export type Welcome = { type: 'welcome'; version: 1; playerId: string; sessionId: string; epoch: string; tickRate: number };
export type Authenticated = { type: 'authenticated'; version: 1 };
export type ServerMessage = Snapshot | ProtocolError | Welcome | Authenticated;

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
  if (value.type === 'welcome' && identifier(value.playerId) && identifier(value.sessionId) && identifier(value.epoch) && value.tickRate === TICK_RATE) return value as Welcome;
  if (value.type === 'authenticated') return value as Authenticated;
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
  return true;
}
