import type { SupabaseClient } from '@supabase/supabase-js';
import { HTTP_GAME_RULES, PROTOCOL_VERSION, parseHttpGameResponse, parseServerMessage } from '@neon/protocol';
import type { AbilityKind, ClientMessage, Snapshot, Vector } from '@neon/protocol';
import { attachKeyboard } from './keyboard';
export type ConnectionView = { status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'; detail: string; playerId: string | null; snapshot: Snapshot | null; abilityNotice?: string; lifecycleNotice?: string; replayPending?: boolean };
class GameRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function connectGame(auth: SupabaseClient, serverUrl: string, onView: (view: ConnectionView) => void, room?: { roomId: string; matchId: string }) {
  let stopped = false, inFlight = false, sessionId: string | null = null, sequence = 0, failures = 0;
  const storageKey = 'neon-grid-http:' + serverUrl + ':' + (room?.roomId ?? 'lab') + ':' + (room?.matchId ?? 'lab');
  // Transport metadata only; never stores positions, scores, clocks or outcomes.
  let needsResume = false;
  function persist() { if (typeof sessionStorage !== 'undefined' && sessionId) sessionStorage.setItem(storageKey, JSON.stringify({ sessionId, nextSequence: sequence })); }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as { sessionId?: unknown; nextSequence?: unknown } | null;
      if (saved && typeof saved.sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(saved.sessionId) && Number.isSafeInteger(saved.nextSequence) && Number(saved.nextSequence) >= 0) {
        sessionId = saved.sessionId; sequence = Number(saved.nextSequence); needsResume = true;
      }
    }
  } catch { /* Invalid transport metadata is replaced after authenticated connect. */ }
  let token = '', requestId = crypto.randomUUID(), timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null, movement: Vector = { x: 0, y: 0 };
  let pending: ClientMessage[] | null = null;
  const intents: ({ type: 'ability'; ability: AbilityKind } | { type: 'lifecycle'; action: 'replay' | 'return'; matchId: string })[] = [];
  let view: ConnectionView = { status: 'connecting', detail: 'Connecting to your match…', playerId: null, snapshot: null };
  const update = (patch: Partial<ConnectionView>) => { view = { ...view, ...patch }; if (!stopped) onView(view); };
  const endpoint = (path: string) => new URL('game/' + path, serverUrl.endsWith('/') ? serverUrl : serverUrl + '/');
  async function request(path: string, body: unknown, accessToken: string) {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), HTTP_GAME_RULES.requestTimeoutMs);
    try {
      const response = await fetch(endpoint(path), { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken, ...(sessionId ? { 'X-Game-Session': sessionId } : {}) },
        body: JSON.stringify(body) });
      const result = await response.json() as { messages?: unknown[]; error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          sessionId = null; needsResume = false; pending = null; intents.splice(0); requestId = crypto.randomUUID();
          if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey);
          if (result.error === 'INVALID_SESSION' || result.messages?.some(raw => (raw as { type?: string; code?: string }).type === 'error' && (raw as { code?: string }).code === 'INVALID_SESSION')) await auth.auth.refreshSession();
        }
        if (response.status === 409 && ['SEQUENCE_CONFLICT', 'STALE_SEQUENCE'].includes(result.error ?? '')) { pending = null; needsResume = true; }
        throw new GameRequestError(response.status, response.status === 503 ? 'Game server unavailable. Retrying…' : response.status === 403 ? 'Game server refused the connection. Retrying…' : 'Connection interrupted. Retrying…');
      }
      const parsed = parseHttpGameResponse(JSON.stringify(result));
      if (!parsed) throw new Error('Invalid HTTP state response.');
      return parsed.messages;
    } finally { clearTimeout(timeout); controller = null; }
  }
  function receive(raw: unknown) {
    const message = parseServerMessage(JSON.stringify(raw));
    if (!message) throw new Error('Unsupported authoritative response.');
    if (message.type === 'welcome') {
      if (sessionId !== message.sessionId) sequence = 0;
      sessionId = message.sessionId; pending = null; intents.splice(0); persist();
      update({ playerId: message.playerId, snapshot: null, replayPending: false, abilityNotice: '', lifecycleNotice: '' });
    } else if (message.type === 'snapshot') {
      if (view.snapshot?.epoch === message.epoch && message.tick < view.snapshot.tick) return;
      const own = message.players.find(player => player.id === view.playerId);
      if (own) sequence = Math.max(sequence, own.lastSequence + 1);
      persist();
      update({ snapshot: message, status: 'connected', detail: 'Match synchronized · movement verified' });
    } else if (message.type === 'ability_rejected') {
      update({ abilityNotice: message.reason === 'COOLDOWN' ? 'Ability is cooling down.' : message.reason === 'NO_DIRECTION' ? 'Move first, then Dash within one second.' : message.reason === 'EXTRACTED' ? 'Extracted. Wait for results.' : message.reason === 'DEAD' ? 'Respawning. Abilities return when alive.' : 'Match complete.' });
    } else if (message.type === 'lifecycle_rejected') {
      update({ replayPending: false, lifecycleNotice: message.reason === 'HOST_ONLY' ? 'Only the current host can control the run.' : message.reason === 'NOT_READY' ? 'At least two connected players are required to replay.' : 'This match action is temporarily unavailable.' });
    } else if (message.type === 'error') {
      sessionId = null; pending = null; requestId = crypto.randomUUID();
      throw new Error(message.code === 'SESSION_IN_USE' ? 'Recovering your player session…' : message.code === 'ROOM_UNAVAILABLE' ? 'Game server unavailable. Retrying…' : message.code === 'MATCH_UNAVAILABLE' ? 'Match changed. Recovering room state…' : message.message);
    }
  }
  async function pump() {
    if (stopped || inFlight) return;
    inFlight = true;
    if (timer) clearTimeout(timer);
    let delay: number = view.snapshot?.gameplay?.match?.phase === 'RESULTS' ? HTTP_GAME_RULES.resultsPollMs : HTTP_GAME_RULES.activePollMs;
    try {
      const { data, error } = await auth.auth.getSession();
      if (stopped) return;
      if (error || !data.session) throw new Error('Session unavailable. Reauthenticate to continue.');
      const accessToken = data.session.access_token;
      if (!sessionId) {
        token = accessToken;
        const messages = await request('connect', { requestId, ...room }, token);
        if (stopped) return;
        messages.forEach(receive);
      } else if (needsResume) {
        token = accessToken;
        const messages = await request('resume', {}, token);
        if (stopped) return;
        messages.forEach(receive); needsResume = false;
      } else {
        if (accessToken !== token) {
          const messages = await request('renew', {}, accessToken);
          if (stopped) return;
          messages.forEach(receive); token = accessToken;
        }
        if (!sessionId) return;
        pending ??= [
          { type: 'input', version: PROTOCOL_VERSION, sessionId, sequence: sequence++, movement: { ...movement } },
          ...intents.splice(0, 7).map(intent => ({ ...intent, version: PROTOCOL_VERSION, sessionId: sessionId!, sequence: sequence++ } as ClientMessage)),
        ];
        persist();
        const messages = await request('step', { actions: pending }, token);
        if (stopped) return;
        pending = null;
        messages.forEach(receive);
        if (!messages.some(raw => (raw as { type?: string }).type === 'snapshot')) {
          sessionId = null; requestId = crypto.randomUUID(); update({ status: 'reconnecting', detail: 'Recovering current match generation…' });
        }
      }
      failures = 0;
    } catch (cause) {
      movement = { x: 0, y: 0 };
      const nextFailure = failures + 1;
      if (!stopped) {
        const authorityOutage = cause instanceof GameRequestError && cause.status === 503;
        update(authorityOutage && nextFailure >= 4
          ? { status: 'error', detail: 'Game server authority is still unavailable. Your room membership is preserved; reconnecting automatically…' }
          : { status: 'reconnecting', detail: cause instanceof TypeError ? 'Connection interrupted. Retrying…' : cause instanceof Error ? cause.message : 'Connection interrupted.' });
      }
      delay = Math.min(500 * 2 ** Math.min(failures++, 4), 8000);
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(() => { void pump(); }, delay);
    }
  }
  const kick = () => { if (!inFlight && view.status === 'connected') { if (timer) clearTimeout(timer); void pump(); } };
  function activateAbility(ability: AbilityKind) {
    if (view.status !== 'connected' || view.snapshot?.gameplay?.match?.phase === 'RESULTS' || intents.length >= 7) return;
    intents.push({ type: 'ability', ability }); update({ abilityNotice: '' }); kick();
  }
  function lifecycle(action: 'replay' | 'return') {
    const match = view.snapshot?.gameplay?.match;
    if (!match || view.replayPending || (action === 'replay' && match.phase !== 'RESULTS')) return;
    intents.push({ type: 'lifecycle', action, matchId: match.id }); update({ replayPending: true }); kick();
  }
  const detachKeyboard = attachKeyboard(value => { const changed = movement.x !== value.x || movement.y !== value.y; movement = value; if (changed) kick(); }, room ? activateAbility : undefined);
  const { data: { subscription } } = auth.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { update({ status: 'error', detail: 'Session ended. Sign in again.' }); cleanup(); }
  });
  function cleanup() {
    if (stopped) return;
    stopped = true; if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey); controller?.abort(); if (timer) clearTimeout(timer);
    detachKeyboard(); subscription.unsubscribe();
    if (sessionId && token) void fetch(endpoint('disconnect'), { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Game-Session': sessionId }, body: '{}' }).catch(() => {});
  }
  update({}); void pump();
  return Object.assign(cleanup, { activateAbility, replay: () => lifecycle('replay'), returnLobby: () => lifecycle('return') });
}
