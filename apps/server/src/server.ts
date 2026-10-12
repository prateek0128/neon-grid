import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { HttpPeer } from './http-peer.ts';
import { createHash } from 'node:crypto';
import { HTTP_GAME_RULES, ABILITY_RULES, INPUT_TIMEOUT_MS, MAX_MESSAGE_BYTES, MAX_PLAYERS, PROTOCOL_VERSION, RECONNECT_GRACE_MS, SNAPSHOT_RATE, TICK_RATE, parseClientMessage } from '@neon/protocol';
import type { ErrorCode, PlayerState, ServerMessage, Snapshot, Vector } from '@neon/protocol';
import { activateAbility, advanceAbilityPosition, advanceGameplay, advancePosition, cancelDash, createGameplay, gameplaySnapshot, playerAlive, reconcileGameplay, spawnPosition } from '@neon/simulation';
import type { GameplayPlayer, GameplayState } from '@neon/simulation';
import type { VerifyToken } from './auth.ts';
import { validateOrigins } from './config.ts';
import { RoomAuthorityError } from './rooms.ts';
import type { AuthorityFailure, RoomStore } from './rooms.ts';
import { readinessCondition } from './readiness.ts';
import type { ReadinessCondition } from './readiness.ts';

type Player = PlayerState & { userId: string; movement: Vector; lastInputAt: number; lastDirection: Vector | null; lastDirectionAt: number; disconnectedAt: number | null; socket: HttpPeer | null };
type ArenaState = { id: string; roomId: string | null; players: Map<string, Player>; eligible: Map<string, { id: string; slot: number }>; gameplay?: GameplayState; lifecycleBusy?: boolean };
type Connection = { player: Player | null; arena: ArenaState | null; sessionId: string; expiresAt: number; authenticating: boolean; accessToken: string | null; lifecycleBusy: boolean; tokens: number; rateAt: number; alive: boolean; authTimer: ReturnType<typeof setTimeout> };
export type ServerDiagnostic = { event: 'http_rejected' | 'http_session_closed' | 'message_rejected' | 'authority_unavailable' | 'authority_recovered' | 'readiness' | 'diagnostics_limited'; reason?: 'closing' | 'path' | 'origin' | 'capacity' | 'not_ready' | 'handshake' | AuthorityFailure | 'unknown'; condition?: ReadinessCondition; syncInFlight?: boolean; authorityFailure?: AuthorityFailure | 'unknown'; path?: 'ws' | 'other'; originAllowed?: boolean; status?: number; code?: number | ErrorCode; authenticated?: boolean; category?: 'origin' | 'membership' | 'session' | 'capacity_or_rate' | 'authority' | 'validation'; scope?: 'connections' | 'readiness' | 'admission' };

export function createGameServer(options: { verifyToken: VerifyToken; allowedOrigins: string[]; rooms?: RoomStore; allowTestArena?: boolean; extractionWindowTicks?: number; matchDurationTicks?: number; shutdownGraceMs?: number; diagnostic?: (event: ServerDiagnostic) => void }) {
  validateOrigins(options.allowedOrigins);
  if (options.shutdownGraceMs !== undefined && (!Number.isSafeInteger(options.shutdownGraceMs) || options.shutdownGraceMs < 0 || options.shutdownGraceMs > 5000)) throw new Error('Invalid shutdown grace.');
  if (options.matchDurationTicks !== undefined && (!Number.isSafeInteger(options.matchDurationTicks) || options.matchDurationTicks < 1)) throw new Error('Invalid match duration.');
  if (options.extractionWindowTicks !== undefined && (!Number.isSafeInteger(options.extractionWindowTicks) || options.extractionWindowTicks < 1)) throw new Error('Invalid extraction window.');
  const connections = new Map<HttpPeer, Connection>();
  const epoch = randomUUID();
  const testArena: ArenaState = { id: epoch, roomId: null, players: new Map(), eligible: new Map() };
  const closedMatches = new Set<string>();
  const arenas = new Map<string, ArenaState>();
  if (options.allowTestArena) arenas.set(epoch, testArena);
  let roomsHealthy = false;
  let lastRoomSync = 0;
  let syncInFlight = false;
  let tick = 0;
  let closing = false;
  let authorityFailure: AuthorityFailure | 'unknown' | null = null;
  let hasSuccessfulSync = false;
  let lastReadinessCondition: ReadinessCondition | null = null; let lastReadinessLog = -Infinity;
  const diagnosticBudgets = { admission: { window: performance.now(), count: 0 }, connections: { window: performance.now(), count: 0 }, readiness: { window: performance.now(), count: 0 } };
  function diagnostic(event: ServerDiagnostic) {
    if (!options.diagnostic) return;
    // Routine connection traffic must not suppress admission rejections or authority diagnostics.
    const scope = event.event === 'http_rejected' ? 'admission' : event.event === 'readiness' || event.event === 'authority_unavailable' || event.event === 'authority_recovered' ? 'readiness' : 'connections';
    const budget = diagnosticBudgets[scope];
    if (performance.now() - budget.window >= 60000) { budget.window = performance.now(); budget.count = 0; }
    if (budget.count++ < 60) options.diagnostic(event);
    else if (budget.count === 61) options.diagnostic({ event: 'diagnostics_limited', scope });
  }
  const currentReadiness = () => readinessCondition({ closing, listening: http.listening, hasRooms: !!options.rooms, allowTestArena: !!options.allowTestArena,
    healthy: roomsHealthy, hasSuccessfulSync, hasFailure: authorityFailure !== null, now: performance.now(), lastSync: lastRoomSync });
  const isReady = () => currentReadiness() === 'ready';
  function reportReadiness() {
    const condition = currentReadiness(); const now = performance.now();
    if (condition !== lastReadinessCondition || (condition !== 'ready' && now - lastReadinessLog >= 30000)) {
      diagnostic({ event: 'readiness', condition, syncInFlight, ...(authorityFailure ? { authorityFailure } : {}) });
      lastReadinessCondition = condition; lastReadinessLog = now;
    }
  }
  const http = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.url?.startsWith('/game/')) { void gameplayHttp(request, response); return; }
    const health = request.url === '/health'; const ready = request.url === '/ready';
    let status = 404; let body: Record<string, string | number> = { error: 'Not found' };
    if (health || ready) {
      if (request.method !== 'GET' && request.method !== 'HEAD') { status = 405; body = { error: 'Method not allowed' }; response.setHeader('Allow', 'GET, HEAD'); }
      else if (health) { status = closing ? 503 : 200; body = { status: closing ? 'closing' : 'ok', protocol: PROTOCOL_VERSION }; }
      else { reportReadiness(); status = isReady() ? 200 : 503; body = { status: status === 200 ? 'ready' : 'not_ready', protocol: PROTOCOL_VERSION }; }
    }
    response.writeHead(status); response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
  });
  http.headersTimeout = 10000; http.requestTimeout = 10000; http.keepAliveTimeout = 5000; http.maxHeadersCount = 32;
  // No upgrade listener: gameplay admission is ordinary authenticated HTTP.
  const connectRequests = new Map<string, { tokenHash: string; peer: HttpPeer; body: string; pending?: Promise<void> }>();
  const requestRates = new Map<string, { at: number; count: number }>();
  async function gameplayHttp(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
    const respond = (status: number, body: unknown) => {
      if (status >= 400) diagnostic({ event: 'http_rejected', status, category: status === 401 ? 'session' : status === 403 ? (options.allowedOrigins.includes(request.headers.origin ?? '') ? 'membership' : 'origin') : status === 429 ? 'capacity_or_rate' : status === 503 ? 'authority' : 'validation' });
      response.writeHead(status); response.end(JSON.stringify(body));
    };
    const origin = request.headers.origin;
    if (!origin || !options.allowedOrigins.includes(origin)) { respond(403, { error: 'ORIGIN_DENIED' }); return; }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Max-Age', '600');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Game-Session');
    if (request.method === 'OPTIONS') { respond(204, null); return; }
    const path = request.url;
    if (!['/game/connect', '/game/step', '/game/state', '/game/resume', '/game/disconnect', '/game/renew'].includes(path ?? '')) { respond(404, { error: 'NOT_FOUND' }); return; }
    if (request.method !== (path === '/game/state' ? 'GET' : 'POST')) { respond(405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    if (!isReady()) { reportReadiness(); respond(503, { error: 'AUTHORITY_UNAVAILABLE' }); return; }
    const token = /^Bearer (.{20,4096})$/.exec(request.headers.authorization ?? '')?.[1];
    const authenticatedSession = typeof request.headers['x-game-session'] === 'string' ?
      [...connections].find(([, c]) => c.sessionId === request.headers['x-game-session'] && c.accessToken === token && c.expiresAt > Date.now())?.[1].sessionId : undefined;
    // Authenticated players have independent budgets even behind one ingress/NAT address.
    const address = authenticatedSession ? 'session:' + authenticatedSession : 'ip:' + (request.socket.remoteAddress ?? 'unknown');
    const now = performance.now();
    for (const [key, rate] of requestRates) if (now - rate.at > 60000) requestRates.delete(key);
    const rate = requestRates.get(address) ?? { at: now, count: 0 };
    if (now - rate.at >= 1000) { rate.at = now; rate.count = 0; }
    if (requestRates.size >= 1024 && !requestRates.has(address)) { respond(429, { error: 'RATE_LIMITED' }); return; }
    requestRates.set(address, rate);
    if (++rate.count > (authenticatedSession ? 60 : 120)) { respond(429, { error: 'RATE_LIMITED' }); return; }
    if (!token) { respond(401, { error: 'AUTH_REQUIRED' }); return; }
    let raw = '';
    try {
      for await (const chunk of request) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) { respond(413, { error: 'PAYLOAD_TOO_LARGE' }); return; }
      }
      const body: unknown = request.method === 'GET' ? {} : JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
      const input = body as Record<string, unknown>;
      const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
      const keys = (expected: string[]) => Object.keys(input).length === expected.length && expected.every(k => Object.hasOwn(input, k));
      const hash = createHash('sha256').update(token).digest('hex');
      let peer: HttpPeer;
      if (path === '/game/connect') {
        const expected = input.roomId !== undefined || input.matchId !== undefined ? ['requestId', 'roomId', 'matchId'] : ['requestId'];
        if (!keys(expected) || !uuid(input.requestId) || (expected.length === 3 && (!uuid(input.roomId) || !uuid(input.matchId)))) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
        for (const [id, cached] of connectRequests) if (cached.peer.readyState !== HttpPeer.OPEN) connectRequests.delete(id);
        const cached = connectRequests.get(input.requestId);
        if (cached) {
          if (cached.tokenHash !== hash || cached.body !== raw) { respond(409, { error: 'REQUEST_CONFLICT' }); return; }
          await cached.pending; peer = cached.peer;
          const existing = connections.get(peer);
          if (!existing?.player || existing.expiresAt <= Date.now()) { peer.close(); respond(401, { error: 'SESSION_EXPIRED' }); return; }
        } else {
          if (connections.size >= 32) { respond(429, { error: 'CAPACITY' }); return; }
          peer = new HttpPeer();
          registerPeer(peer);
          const pending = peer.dispatch(JSON.stringify({ type: 'authenticate', version: PROTOCOL_VERSION, accessToken: token,
            ...(expected.length === 3 ? { roomId: input.roomId, matchId: input.matchId } : {}) }));
          connectRequests.set(input.requestId, { tokenHash: hash, peer, body: raw, pending });
          await pending;
        }
      } else {
        const session = request.headers['x-game-session'];
        const entry = typeof session === 'string' && uuid(session) ? [...connections].find(([, c]) => c.sessionId === session) : undefined;
        if (!entry || entry[1].expiresAt <= Date.now()) { respond(401, { error: 'SESSION_EXPIRED' }); return; }
        peer = entry[0];
        const connection = entry[1];
        if (path === '/game/renew' || (path === '/game/resume' && connection.accessToken !== token)) {
          if (!keys([])) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
          await peer.dispatch(JSON.stringify({ type: 'authenticate', version: PROTOCOL_VERSION, accessToken: token,
            ...(connection.arena?.roomId ? { roomId: connection.arena.roomId, matchId: connection.arena.id } : {}) }));
        } else {
          if (connection.accessToken !== token) { respond(401, { error: 'INVALID_SESSION' }); return; }
          if (path === '/game/resume') {
            if (!keys([]) || peer.busy) { respond(409, { error: 'BUSY' }); return; }
          }
          if (path === '/game/disconnect') {
            if (!keys([])) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
            peer.close(); respond(200, { messages: [] }); return;
          }
          if (path === '/game/step') {
            if (!keys(['actions']) || !Array.isArray(input.actions) || input.actions.length > HTTP_GAME_RULES.maximumBatch) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
            const actions = input.actions.map(action => parseClientMessage(JSON.stringify(action)));
            if (actions.some(action => !action || action.type === 'authenticate' || action.sessionId !== connection.sessionId)) { respond(400, { error: 'INVALID_MESSAGE' }); return; }
            if (peer.busy) { respond(409, { error: 'BUSY' }); return; }
            peer.busy = true;
            try {
              for (const action of actions) {
                if (!action || action.type === 'authenticate') continue;
                // Identical request retries are acknowledged without repeating abilities or lifecycle effects.
                const previous = peer.accepted.get(action.sequence);
                const encoded = JSON.stringify(action);
                if (previous !== undefined) {
                  if (previous !== encoded) { respond(409, { error: 'SEQUENCE_CONFLICT' }); return; }
                  continue;
                }
                // HTTP requests may arrive late after reload. Reject an unseen older
                // sequence without closing the current session or replacing newer intent.
                if (action.sequence <= (connection.player?.lastSequence ?? -1)) {
                  respond(409, { error: 'STALE_SEQUENCE' }); return;
                }
                await peer.dispatch(encoded);
                peer.accepted.set(action.sequence, encoded);
                if (peer.accepted.size > 128) peer.accepted.delete(peer.accepted.keys().next().value!);
                if (peer.readyState !== HttpPeer.OPEN) break;
              }
            } finally { peer.busy = false; }
          }
        }
      }
      peer.lastSeen = performance.now();
      const connection = connections.get(peer);
      const messages = peer.drain();
      if (connection?.player && connection.arena) {
        if ((path === '/game/connect' || path === '/game/resume') && !messages.some(m => m.type === 'welcome')) messages.unshift({ type: 'welcome', version: PROTOCOL_VERSION, playerId: connection.player.id, sessionId: connection.sessionId, epoch: connection.arena.gameplay?.match.id ?? connection.arena.id, tickRate: TICK_RATE });
        messages.push(snapshot(connection.arena));
      }
      const failure = messages.find(m => m.type === 'error');
      const status = failure?.type === 'error' ? (
        ['INVALID_SESSION', 'AUTH_REQUIRED'].includes(failure.code) ? 401 :
        ['NOT_MEMBER', 'ROOM_REQUIRED'].includes(failure.code) ? 403 :
        ['AUTH_UNAVAILABLE', 'ROOM_UNAVAILABLE', 'SERVER_CLOSING'].includes(failure.code) ? 503 : 409
      ) : 200;
      respond(status, { messages });
    } catch { if (!response.writableEnded) respond(400, { error: 'INVALID_MESSAGE' }); }
  }
  function send(ws: HttpPeer, message: ServerMessage) {
    if (ws.readyState !== HttpPeer.OPEN) return;
    if (ws.bufferedAmount > 65536) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  function reject(ws: HttpPeer, code: ErrorCode, message: string) {
    diagnostic({ event: 'message_rejected', code });
    send(ws, { type: 'error', version: PROTOCOL_VERSION, code, message });
    ws.close(code === 'SESSION_IN_USE' ? 4009 : 1008, code);
  }
  function snapshot(arena: ArenaState): Snapshot {
    return { type: 'snapshot', version: PROTOCOL_VERSION, epoch: arena.gameplay?.match.id ?? arena.id, tick, players: [...arena.players.values()].map(p => ({ id: p.id, slot: p.slot, position: { ...p.position }, connected: p.connected, lastSequence: p.lastSequence })),
      ...(arena.gameplay ? { gameplay: gameplaySnapshot(arena.gameplay) } : {}) };
  }
  function gameplayPlayers(arena: ArenaState, previousPositions?: Map<string, Vector>): GameplayPlayer[] {
    return [...arena.eligible].map(([userId, member]) => {
      const player = arena.players.get(userId);
      const connection = player?.socket ? connections.get(player.socket) : null;
      return { id: member.id, slot: member.slot, position: player?.position ?? arena.gameplay?.vitals.find(v => v.id === member.id)?.respawnPosition ?? spawnPosition(member.slot), previousPosition: previousPositions?.get(member.id),
        connected: !!(player?.connected && player.socket?.readyState === HttpPeer.OPEN && connection?.expiresAt && connection.expiresAt > Date.now()) };
    });
  }
  function broadcast() {
    // HTTP clients fetch current state; no per-tick delivery buffers or transport subscriptions.
  }
  function expireDisconnected(now: number) {
    for (const arena of arenas.values()) for (const [userId, player] of arena.players) {
      if (player.disconnectedAt !== null && now - player.disconnectedAt >= RECONNECT_GRACE_MS && arena.gameplay?.extraction?.players.find(p => p.id === player.id)?.outcome !== 'extracted') arena.players.delete(userId);
    }
  }
  async function syncRooms() {
    if (!options.rooms || syncInFlight || closing) return;
    syncInFlight = true;
    try {
      const connected = [...connections].filter(([ws,c]) => ws.readyState===HttpPeer.OPEN && c.player && c.arena?.roomId && c.expiresAt>Date.now()).map(([,c])=>c.player!.id);
      const states = await options.rooms.tick(epoch, connected);
      if (closing) return;
      const activeMatches = new Set(states.filter(state => !closedMatches.has(state.matchId)).map(state => state.matchId));
      for (const id of closedMatches) if (!states.some(state => state.matchId === id)) closedMatches.delete(id);
      for (const state of states) {
        if (closedMatches.has(state.matchId)) continue;
        let arena = arenas.get(state.matchId);
        if (!arena) {
          arena = { id: state.matchId, roomId: state.roomId, players: new Map(), eligible: new Map(), gameplay: createGameplay(options.matchDurationTicks, state.matchId, options.extractionWindowTicks) };
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
      if (!roomsHealthy) diagnostic({ event: 'authority_recovered' });
      authorityFailure = null; roomsHealthy = true; hasSuccessfulSync = true; lastRoomSync = performance.now();
    } catch (error) {
      const reason = error instanceof RoomAuthorityError ? error.reason : 'unknown';
      if (reason !== authorityFailure) diagnostic({ event: 'authority_unavailable', reason });
      authorityFailure = reason;
      roomsHealthy = false;
      for (const [ws, connection] of connections) if (connection.arena?.roomId) reject(ws, 'ROOM_UNAVAILABLE', 'Room authority unavailable. Reconnecting…');
    } finally { syncInFlight = false; reportReadiness(); }
  }
  const roomTimer = setInterval(() => { void syncRooms(); reportReadiness(); }, 1000);
  void syncRooms();
  function registerPeer(ws: HttpPeer) {
    const connection: Connection = { player: null, arena: null, sessionId: randomUUID(), expiresAt: 0, authenticating: false, accessToken: null, lifecycleBusy: false, tokens: 90, rateAt: performance.now(), alive: true,
      authTimer: setTimeout(() => reject(ws, 'AUTH_REQUIRED', 'Authenticate within five seconds.'), 5000) };
    connections.set(ws, connection);
    ws.on('close', code => {
      diagnostic({ event: 'http_session_closed', code, authenticated: !!connection.player });
      clearTimeout(connection.authTimer);
      connections.delete(ws); connection.accessToken = null;
      const player = connection.player;
      if (player?.socket === ws) {
        player.socket = null;
        player.connected = false;
        player.movement = { x: 0, y: 0 };
        player.disconnectedAt = performance.now();
        if (connection.arena?.gameplay) cancelDash(connection.arena.gameplay, player.id);
        broadcast();
      }
    });
    ws.handler = async (raw, binary) => {
      if (ws.readyState !== HttpPeer.OPEN) return;
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
        if (ws.readyState !== HttpPeer.OPEN || closing) return;
        if (!identity || identity.expiresAt <= Date.now() || (connection.player && connection.player.userId !== identity.userId)) {
          reject(ws, 'INVALID_SESSION', 'A valid session for this player is required.'); return;
        }
        if (connection.player) {
          if (connection.arena?.roomId && (message.roomId !== connection.arena.roomId || message.matchId !== connection.arena.id)) {
            reject(ws, 'INVALID_SESSION', 'Room identity cannot change on renewal.'); return;
          }
          connection.accessToken = message.accessToken;
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
          if (ws.readyState !== HttpPeer.OPEN || closing) return;
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
        if (player?.socket && player.socket.readyState !== HttpPeer.CLOSED) { reject(ws, 'SESSION_IN_USE', 'This identity is already connected in another tab.'); return; }
        if (!player) {
          if (players.size >= MAX_PLAYERS) { reject(ws, 'ARENA_FULL', 'The four-player test arena is full.'); return; }
          const usedSlots = new Set([...players.values()].map(p => p.slot));
          const slot = member?.slot ?? [1, 2, 3, 4].find(s => !usedSlots.has(s))!;
          player = { id: member?.id ?? randomUUID(), userId: identity.userId, slot, position: { ...(arena.gameplay?.vitals.find(v => v.id === member?.id)?.respawnPosition ?? spawnPosition(slot)) }, connected: true, lastSequence: -1, movement: { x: 0, y: 0 }, lastInputAt: now, lastDirection: null, lastDirectionAt: 0, disconnectedAt: null, socket: ws };
          players.set(identity.userId, player);
        }
        player.socket = ws;
        player.connected = true;
        player.disconnectedAt = null;
        player.movement = { x: 0, y: 0 };
        player.lastSequence = -1;
        player.lastDirection = null;
        connection.player = player;
        connection.accessToken = message.accessToken;
        connection.expiresAt = identity.expiresAt;
        clearTimeout(connection.authTimer);
        send(ws, { type: 'welcome', version: PROTOCOL_VERSION, playerId: player.id, sessionId: connection.sessionId, epoch: arena.gameplay?.match.id ?? arena.id, tickRate: TICK_RATE });
        broadcast();
        return;
      }
      const player = connection.player;
      if (!player) { reject(ws, 'AUTH_REQUIRED', 'Authenticate before sending input.'); return; }
      if (connection.expiresAt <= Date.now() || message.sessionId !== connection.sessionId) { reject(ws, 'INVALID_SESSION', 'Session expired or incorrect.'); return; }
      if (message.sequence <= player.lastSequence) { reject(ws, 'STALE_SEQUENCE', 'Input sequence must increase.'); return; }
      player.lastSequence = message.sequence;
      if (message.type === 'lifecycle') {
        const arena = connection.arena;
        const deny = (reason: import('@neon/protocol').LifecycleRejected['reason']) => send(ws, { type: 'lifecycle_rejected', version: PROTOCOL_VERSION, reason });
        if (!arena?.gameplay || !arena.roomId || arenas.get(arena.id) !== arena) { deny('INVALID_TRANSITION'); return; }
        if (message.matchId !== arena.gameplay.match.id) { deny('STALE_MATCH'); return; }
        if (message.action === 'replay' && arena.gameplay.match.phase !== 'RESULTS') { deny('INVALID_TRANSITION'); return; }
        if (connection.lifecycleBusy || arena.lifecycleBusy) { deny('BUSY'); return; }
        if (!roomsHealthy || now - lastRoomSync > 5000 || !connection.accessToken) { deny('ROOM_UNAVAILABLE'); return; }
        connection.lifecycleBusy = true; arena.lifecycleBusy = true;
        try {
          const authorization = await options.rooms!.authorize(connection.accessToken, arena.roomId, arena.id, epoch);
          if (ws.readyState !== HttpPeer.OPEN || closing || arenas.get(arena.id) !== arena) return;
          if (!authorization || authorization.id !== player.id || !authorization.host) { deny('HOST_ONLY'); return; }
          if (connection.expiresAt <= Date.now() || arena.eligible.get(player.userId)?.id !== player.id) { deny('HOST_ONLY'); return; }
          if (arena.gameplay.match.id !== message.matchId || (message.action === 'replay' && arena.gameplay.match.phase !== 'RESULTS')) { deny('STALE_MATCH'); return; }
          if (!roomsHealthy || performance.now() - lastRoomSync > 5000) { deny('ROOM_UNAVAILABLE'); return; }
          if (message.action === 'return') {
            if (!options.rooms?.returnLobby || authorization.revision === undefined || !await options.rooms.returnLobby(connection.accessToken, arena.roomId, authorization.revision)) { deny('ROOM_UNAVAILABLE'); return; }
            closedMatches.add(arena.id);
            if (arenas.get(arena.id) === arena) {
              arenas.delete(arena.id);
              for (const member of arena.players.values()) if (member.socket) reject(member.socket, 'MATCH_UNAVAILABLE', 'Match ended. Return to the lobby.');
            }
            return;
          }
          if (gameplayPlayers(arena).filter(p => p.connected).length < 2) { deny('NOT_READY'); return; }
          arena.gameplay = createGameplay(options.matchDurationTicks, undefined, options.extractionWindowTicks);
          for (const member of arena.players.values()) {
            member.position = spawnPosition(member.slot); member.movement = { x: 0, y: 0 }; member.lastDirection = null; member.lastSequence = -1;
          }
          reconcileGameplay(arena.gameplay, gameplayPlayers(arena));
          // Reconnect creates new session IDs. Packets queued on old sockets cannot enter the new generation.
          for (const member of arena.players.values()) member.socket?.close(1012, 'New match generation');
        } catch { deny('ROOM_UNAVAILABLE'); }
        finally { connection.lifecycleBusy = false; arena.lifecycleBusy = false; }
        return;
      }
      if (message.type === 'ability') {
        const arena = connection.arena;
        if (!arena?.roomId || !arena.gameplay || arenas.get(arena.id) !== arena) { reject(ws, 'MATCH_UNAVAILABLE', 'Abilities require an active room match.'); return; }
        if (!roomsHealthy || now - lastRoomSync > 5000) { reject(ws, 'ROOM_UNAVAILABLE', 'Room authority unavailable.'); return; }
        if (!player.connected || player.socket !== ws || arena.eligible.get(player.userId)?.id !== player.id) { reject(ws, 'NOT_MEMBER', 'Current membership is required.'); return; }
        const direction = now - player.lastDirectionAt <= ABILITY_RULES.directionMemoryMs ? player.lastDirection : null;
        const result = activateAbility(arena.gameplay, player.id, message.ability, player.position, direction);
        if (result === 'NOT_MEMBER') { reject(ws, 'NOT_MEMBER', 'Current membership is required.'); return; }
        if (result) send(ws, { type: 'ability_rejected', version: PROTOCOL_VERSION, ability: message.ability, reason: result });
        else broadcast();
        return;
      }
      if (connection.arena?.gameplay && (connection.arena.gameplay.match.phase !== 'ACTIVE' || !playerAlive(connection.arena.gameplay, player.id))) {
        player.movement = { x: 0, y: 0 }; player.lastDirection = null; return;
      }
      player.movement = message.movement;
      player.lastInputAt = now;
      if (Math.hypot(message.movement.x, message.movement.y) > 0) {
        player.lastDirection = { ...message.movement }; player.lastDirectionAt = now;
      }
    };
  }
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
        if (arena.gameplay?.match.phase === 'RESULTS') continue;
        const previousPositions = new Map([...arena.players.values()].map(p => [p.id, { ...p.position }]));
        for (const player of arena.players.values()) {
          if (!healthy) player.movement = { x: 0, y: 0 };
          if (!player.connected || player.socket?.readyState !== HttpPeer.OPEN || now - player.lastInputAt > INPUT_TIMEOUT_MS) player.movement = { x: 0, y: 0 };
          if (healthy && arena.gameplay && player.connected && player.socket?.readyState === HttpPeer.OPEN) {
            player.position = advanceAbilityPosition(arena.gameplay, player.id, player.position, player.movement);
          } else {
            if (arena.gameplay) cancelDash(arena.gameplay, player.id);
            player.position = advancePosition(player.position, player.movement, 1 / TICK_RATE);
          }
        }
        if (healthy && arena.gameplay) {
          const currentPlayers = gameplayPlayers(arena, previousPositions);
          advanceGameplay(arena.gameplay, currentPlayers);
          if (arena.gameplay.match.results !== null) {
            for (const member of arena.players.values()) {
              member.movement = { x: 0, y: 0 }; member.lastDirection = null;
              if (member.socket) send(member.socket, { type: 'match_complete', version: PROTOCOL_VERSION, results: arena.gameplay.match.results! });
            }
            broadcast();
          }
          for (const player of arena.players.values()) {
            const current = currentPlayers.find(p => p.id === player.id);
            if (current) {
              const relocated = player.position !== current.position;
              player.position = current.position;
              if (relocated || !playerAlive(arena.gameplay, player.id)) { player.movement = { x: 0, y: 0 }; player.lastDirection = null; }
            }
          }
        }
      }
      accumulator -= stepMs;
      if (tick % (TICK_RATE / SNAPSHOT_RATE) === 0) broadcast();
    }
  }, 8);
  const heartbeatTimer = setInterval(() => {
    for (const [peer, connection] of connections) if (connection.player && performance.now() - peer.lastSeen > HTTP_GAME_RULES.sessionIdleMs) peer.close();
  }, 500);
  let shutdown: Promise<void> | null = null;
  function close(): Promise<void> {
    if (shutdown) return shutdown;
    closing = true;
    clearInterval(simulationTimer); clearInterval(heartbeatTimer); clearInterval(roomTimer);
    for (const [ws, connection] of connections) {
      clearTimeout(connection.authTimer);
      connection.accessToken = null;
      if (connection.player) connection.player.movement = { x: 0, y: 0 };
      send(ws, { type: 'error', version: PROTOCOL_VERSION, code: 'SERVER_CLOSING', message: 'Server restarting.' });
      ws.close(1012, 'Server restarting');
    }
    shutdown = (async () => {
      const deadline = setTimeout(() => {
        for (const ws of connections.keys()) ws.terminate();
        http.closeAllConnections();
      }, options.shutdownGraceMs ?? 2000);
      try {
        for (const peer of connections.keys()) peer.close();
        const httpClosed = new Promise<void>(resolve => http.close(() => resolve()));
        http.closeIdleConnections();
        await httpClosed;
      } finally { clearTimeout(deadline); connections.clear(); arenas.clear(); }
    })();
    return shutdown;
  }
  return { http, close };
}
