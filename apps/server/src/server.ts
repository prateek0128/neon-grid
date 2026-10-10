import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { INPUT_TIMEOUT_MS, MAX_MESSAGE_BYTES, MAX_PLAYERS, PROTOCOL_VERSION, RECONNECT_GRACE_MS, SNAPSHOT_RATE, TICK_RATE, parseClientMessage } from '@neon/protocol';
import type { ErrorCode, PlayerState, ServerMessage, Snapshot, Vector } from '@neon/protocol';
import { advanceGameplay, advancePosition, createGameplay, gameplaySnapshot, reconcileGameplay, spawnPosition } from '@neon/simulation';
import type { GameplayPlayer, GameplayState } from '@neon/simulation';
import type { VerifyToken } from './auth.ts';
import type { RoomStore } from './rooms.ts';

type Player = PlayerState & { userId: string; movement: Vector; lastInputAt: number; disconnectedAt: number | null; socket: WebSocket | null };
type ArenaState = { id: string; roomId: string | null; players: Map<string, Player>; eligible: Map<string, { id: string; slot: number }>; gameplay?: GameplayState };
type Connection = { player: Player | null; arena: ArenaState | null; sessionId: string; expiresAt: number; authenticating: boolean; tokens: number; rateAt: number; alive: boolean; authTimer: ReturnType<typeof setTimeout> };

export function createGameServer(options: { verifyToken: VerifyToken; allowedOrigins: string[]; rooms?: RoomStore; allowTestArena?: boolean }) {
  const connections = new Map<WebSocket, Connection>();
  const epoch = randomUUID();
  const testArena: ArenaState = { id: epoch, roomId: null, players: new Map(), eligible: new Map() };
  const arenas = new Map<string, ArenaState>();
  if (options.allowTestArena) arenas.set(epoch, testArena);
  let roomsHealthy = false;
  let lastRoomSync = 0;
  let syncInFlight = false;
  let tick = 0;
  let closing = false;
  const http = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.writeHead(request.url === '/health' && !closing ? 200 : 404);
    response.end(JSON.stringify(request.url === '/health' ? { status: closing ? 'closing' : 'ok', protocol: PROTOCOL_VERSION } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  http.on('upgrade', (request, socket, head) => {
    if (closing || request.url !== '/ws' || !options.allowedOrigins.includes(request.headers.origin ?? '') || connections.size >= 32) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 65536) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  function reject(ws: WebSocket, code: ErrorCode, message: string) {
    send(ws, { type: 'error', version: PROTOCOL_VERSION, code, message });
    ws.close(code === 'SESSION_IN_USE' ? 4009 : 1008, code);
  }
  function snapshot(arena: ArenaState): Snapshot {
    return { type: 'snapshot', version: PROTOCOL_VERSION, epoch: arena.id, tick, players: [...arena.players.values()].map(p => ({ id: p.id, slot: p.slot, position: { ...p.position }, connected: p.connected, lastSequence: p.lastSequence })),
      ...(arena.gameplay ? { gameplay: gameplaySnapshot(arena.gameplay) } : {}) };
  }
  function gameplayPlayers(arena: ArenaState): GameplayPlayer[] {
    return [...arena.eligible].map(([userId, member]) => {
      const player = arena.players.get(userId);
      const connection = player?.socket ? connections.get(player.socket) : null;
      return { id: member.id, slot: member.slot, position: player?.position ?? spawnPosition(member.slot),
        connected: !!(player?.connected && player.socket?.readyState === WebSocket.OPEN && connection?.expiresAt && connection.expiresAt > Date.now()) };
    });
  }
  function broadcast() {
    const snapshots = new Map<string, Snapshot>();
    for (const [ws, connection] of connections) if (connection.player && connection.arena) {
      if (!snapshots.has(connection.arena.id)) snapshots.set(connection.arena.id, snapshot(connection.arena));
      send(ws, snapshots.get(connection.arena.id)!);
    }
  }
  function expireDisconnected(now: number) {
    for (const arena of arenas.values()) for (const [userId, player] of arena.players) {
      if (player.disconnectedAt !== null && now - player.disconnectedAt >= RECONNECT_GRACE_MS) arena.players.delete(userId);
    }
  }
  async function syncRooms() {
    if (!options.rooms || syncInFlight || closing) return;
    syncInFlight = true;
    try {
      const connected = [...connections].filter(([ws,c]) => ws.readyState===WebSocket.OPEN && c.player && c.arena?.roomId && c.expiresAt>Date.now()).map(([,c])=>c.player!.id);
      const states = await options.rooms.tick(epoch, connected);
      if (closing) return;
      roomsHealthy = true;
      lastRoomSync = performance.now();
      const activeMatches = new Set(states.map(state => state.matchId));
      for (const state of states) {
        let arena = arenas.get(state.matchId);
        if (!arena) {
          arena = { id: state.matchId, roomId: state.roomId, players: new Map(), eligible: new Map(), gameplay: createGameplay() };
          arenas.set(state.matchId, arena);
        }
        arena.eligible = new Map(state.members.map(m => [m.userId, { id: m.id, slot: m.slot }]));
        for (const [userId, player] of arena.players) if (!arena.eligible.has(userId)) {
          if (player.socket) reject(player.socket, 'NOT_MEMBER', 'Room membership was revoked.');
          arena.players.delete(userId);
        }
        reconcileGameplay(arena.gameplay!, gameplayPlayers(arena));
      }
      for (const [id, arena] of arenas) if (arena.roomId && !activeMatches.has(id)) {
        for (const player of arena.players.values()) if (player.socket) reject(player.socket, 'MATCH_UNAVAILABLE', 'Movement session ended. Return to the lobby.');
        arenas.delete(id);
      }
    } catch {
      roomsHealthy = false;
      for (const [ws, connection] of connections) if (connection.arena?.roomId) reject(ws, 'ROOM_UNAVAILABLE', 'Room authority unavailable. Reconnecting…');
    } finally { syncInFlight = false; }
  }
  const roomTimer = setInterval(() => { void syncRooms(); }, 1000);
  void syncRooms();
  wss.on('connection', (ws: WebSocket) => {
    const connection: Connection = { player: null, arena: null, sessionId: randomUUID(), expiresAt: 0, authenticating: false, tokens: 90, rateAt: performance.now(), alive: true,
      authTimer: setTimeout(() => reject(ws, 'AUTH_REQUIRED', 'Authenticate within five seconds.'), 5000) };
    connections.set(ws, connection);
    ws.on('error', () => { /* Socket close handles player cleanup. Do not log payloads or tokens. */ });
    ws.on('pong', () => { connection.alive = true; });
    ws.on('close', () => {
      clearTimeout(connection.authTimer);
      connections.delete(ws);
      const player = connection.player;
      if (player?.socket === ws) {
        player.socket = null;
        player.connected = false;
        player.movement = { x: 0, y: 0 };
        player.disconnectedAt = performance.now();
        broadcast();
      }
    });
    ws.on('message', async (raw, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      connection.tokens = Math.min(90, connection.tokens + (now - connection.rateAt) * 0.06);
      connection.rateAt = now;
      if (connection.tokens < 1) { reject(ws, 'RATE_LIMITED', 'Too many messages.'); return; }
      connection.tokens -= 1;
      const message = binary ? null : parseClientMessage(raw.toString());
      if (!message) { reject(ws, 'INVALID_MESSAGE', 'Malformed or unsupported message.'); return; }
      if (message.type === 'authenticate') {
        if (connection.authenticating) { reject(ws, 'INVALID_MESSAGE', 'Authentication already in progress.'); return; }
        connection.authenticating = true;
        let identity;
        try { identity = await options.verifyToken(message.accessToken); }
        catch { connection.authenticating = false; reject(ws, 'AUTH_UNAVAILABLE', 'Identity service unavailable. Try again.'); return; }
        connection.authenticating = false;
        if (ws.readyState !== WebSocket.OPEN || closing) return;
        if (!identity || identity.expiresAt <= Date.now() || (connection.player && connection.player.userId !== identity.userId)) {
          reject(ws, 'INVALID_SESSION', 'A valid session for this player is required.'); return;
        }
        if (connection.player) {
          if (connection.arena?.roomId && (message.roomId !== connection.arena.roomId || message.matchId !== connection.arena.id)) {
            reject(ws, 'INVALID_SESSION', 'Room identity cannot change on renewal.'); return;
          }
          connection.expiresAt = identity.expiresAt;
          send(ws, { type: 'authenticated', version: PROTOCOL_VERSION });
          return;
        }
        let arena = testArena;
        let member: { id: string; slot: number } | null = null;
        if (message.roomId && message.matchId) {
          if (!options.rooms || !roomsHealthy || performance.now() - lastRoomSync > 5000) { reject(ws, 'ROOM_UNAVAILABLE', 'Room authority unavailable.'); return; }
          connection.authenticating = true;
          try { member = await options.rooms.authorize(message.accessToken, message.roomId, message.matchId, epoch); }
          catch { reject(ws, 'ROOM_UNAVAILABLE', 'Room authorization unavailable.'); return; }
          finally { connection.authenticating = false; }
          if (ws.readyState !== WebSocket.OPEN || closing) return;
          const target = arenas.get(message.matchId);
          if (!member || !target || target.roomId !== message.roomId || target.eligible.get(identity.userId)?.id !== member.id) {
            reject(ws, 'NOT_MEMBER', 'Active membership in this server match is required.'); return;
          }
          arena = target;
        } else if (!options.allowTestArena) { reject(ws, 'ROOM_REQUIRED', 'Join and start a room before connecting.'); return; }
        connection.arena = arena;
        const players = arena.players;
        expireDisconnected(performance.now());
        let player = players.get(identity.userId);
        if (player?.socket && player.socket.readyState !== WebSocket.CLOSED) { reject(ws, 'SESSION_IN_USE', 'This identity is already connected in another tab.'); return; }
        if (!player) {
          if (players.size >= MAX_PLAYERS) { reject(ws, 'ARENA_FULL', 'The four-player test arena is full.'); return; }
          const usedSlots = new Set([...players.values()].map(p => p.slot));
          const slot = member?.slot ?? [1, 2, 3, 4].find(s => !usedSlots.has(s))!;
          player = { id: member?.id ?? randomUUID(), userId: identity.userId, slot, position: spawnPosition(slot), connected: true, lastSequence: -1, movement: { x: 0, y: 0 }, lastInputAt: now, disconnectedAt: null, socket: ws };
          players.set(identity.userId, player);
        }
        player.socket = ws;
        player.connected = true;
        player.disconnectedAt = null;
        player.movement = { x: 0, y: 0 };
        player.lastSequence = -1;
        connection.player = player;
        connection.expiresAt = identity.expiresAt;
        clearTimeout(connection.authTimer);
        send(ws, { type: 'welcome', version: PROTOCOL_VERSION, playerId: player.id, sessionId: connection.sessionId, epoch: arena.id, tickRate: TICK_RATE });
        broadcast();
        return;
      }
      const player = connection.player;
      if (!player) { reject(ws, 'AUTH_REQUIRED', 'Authenticate before sending input.'); return; }
      if (connection.expiresAt <= Date.now() || message.sessionId !== connection.sessionId) { reject(ws, 'INVALID_SESSION', 'Session expired or incorrect.'); return; }
      if (message.sequence <= player.lastSequence) { reject(ws, 'STALE_SEQUENCE', 'Input sequence must increase.'); return; }
      player.lastSequence = message.sequence;
      player.movement = message.movement;
      player.lastInputAt = now;
    });
  });
  const stepMs = 1000 / TICK_RATE;
  let previous = performance.now();
  let accumulator = 0;
  const simulationTimer = setInterval(() => {
    const now = performance.now();
    // Bound catch-up after a long process stall; never turn delay into a movement teleport.
    accumulator += Math.min(now - previous, 5 * stepMs);
    previous = now;
    for (const [ws, connection] of connections) if (connection.player && connection.expiresAt <= Date.now()) reject(ws, 'INVALID_SESSION', 'Session expired.');
    expireDisconnected(now);
    while (accumulator >= stepMs) {
      tick += 1;
      for (const arena of arenas.values()) {
        const healthy = !arena.roomId || (roomsHealthy && now - lastRoomSync <= 5000);
        for (const player of arena.players.values()) {
          if (!healthy) player.movement = { x: 0, y: 0 };
          if (!player.connected || player.socket?.readyState !== WebSocket.OPEN || now - player.lastInputAt > INPUT_TIMEOUT_MS) player.movement = { x: 0, y: 0 };
          player.position = advancePosition(player.position, player.movement, 1 / TICK_RATE);
        }
        if (healthy && arena.gameplay) advanceGameplay(arena.gameplay, gameplayPlayers(arena));
      }
      accumulator -= stepMs;
      if (tick % (TICK_RATE / SNAPSHOT_RATE) === 0) broadcast();
    }
  }, 8);
  const heartbeatTimer = setInterval(() => {
    for (const [ws, connection] of connections) {
      if (!connection.alive) { ws.terminate(); continue; }
      connection.alive = false;
      ws.ping();
    }
  }, 10000);
  return {
    http,
    async close() {
      closing = true;
      clearInterval(simulationTimer);
      clearInterval(heartbeatTimer);
      clearInterval(roomTimer);
      for (const [ws, connection] of connections) {
        clearTimeout(connection.authTimer);
        send(ws, { type: 'error', version: PROTOCOL_VERSION, code: 'SERVER_CLOSING', message: 'Server restarting.' });
        ws.terminate();
      }
      arenas.clear();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}
