// Historical test-only client, not imported by the application.
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROTOCOL_VERSION, TICK_RATE, parseServerMessage } from '@neon/protocol';
import type { AbilityKind, Snapshot, Vector } from '@neon/protocol';
import { attachKeyboard } from './keyboard';

export type ConnectionView = { status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'; detail: string; playerId: string | null; snapshot: Snapshot | null; abilityNotice?: string; lifecycleNotice?: string; replayPending?: boolean };
export function connectGame(auth: SupabaseClient, serverUrl: string, onView: (view: ConnectionView) => void, room?: { roomId: string; matchId: string }) {
  let stopped = false;
  let opening = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let sequence = 0;
  let sessionId: string | null = null;
  let terminal = false;
  let refreshAuth = false;
  let authFailures = 0;
  let movement: Vector = { x: 0, y: 0 };
  let view: ConnectionView = { status: 'connecting', detail: 'Validating identity…', playerId: null, snapshot: null };
  const update = (patch: Partial<ConnectionView>) => { view = { ...view, ...patch }; if (!stopped) onView(view); };
  let replayGeneration: string | null = null;
  function lifecycle(action: 'replay' | 'return') {
    const match = view.snapshot?.gameplay?.match;
    if (!match || (action === 'replay' && match.phase !== 'RESULTS') || replayGeneration === match.id || stopped || terminal || socket?.readyState !== WebSocket.OPEN || !sessionId) return;
    replayGeneration = match.id;
    update({ replayPending: true, lifecycleNotice: '' });
    socket.send(JSON.stringify({ type: 'lifecycle', version: PROTOCOL_VERSION, sessionId, sequence: sequence++, matchId: match.id, action }));
  }
  function sendInput() {
    if (view.snapshot?.gameplay?.match?.phase === 'RESULTS') return;
    if (!stopped && socket?.readyState === WebSocket.OPEN && sessionId && !terminal) {
      socket.send(JSON.stringify({ type: 'input', version: PROTOCOL_VERSION, sessionId, sequence: sequence++, movement }));
    }
  }
  function sendAbility(ability: AbilityKind) {
    if (view.snapshot?.gameplay?.match?.phase === 'RESULTS') return;
    if (!stopped && room && socket?.readyState === WebSocket.OPEN && sessionId && !terminal) {
      socket.send(JSON.stringify({ type: 'ability', version: PROTOCOL_VERSION, sessionId, sequence: sequence++, ability }));
      update({ abilityNotice: '' });
    }
  }
  const detachKeyboard = attachKeyboard(value => { movement = value; sendInput(); }, room ? sendAbility : undefined);
  const inputTimer = setInterval(sendInput, 1000 / TICK_RATE);
  const { data: { subscription } } = auth.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session && socket?.readyState === WebSocket.OPEN && sessionId) {
      socket.send(JSON.stringify({ type: 'authenticate', version: PROTOCOL_VERSION, accessToken: session.access_token, ...room }));
    }
    if (event === 'SIGNED_OUT') {
      terminal = true;
      update({ status: 'error', detail: 'Session ended. Disconnect and connect again.' });
      socket?.close();
    }
  });
  async function open() {
    if (stopped || terminal || opening || (socket && socket.readyState < WebSocket.CLOSING)) return;
    opening = true;
    try {
      if (refreshAuth) {
        refreshAuth = false;
        const renewed = await auth.auth.refreshSession();
        if (renewed.error || !renewed.data.session) throw new Error('Session expired. Reload to authenticate again.');
      }
      const { data, error } = await auth.auth.getSession();
      if (stopped || terminal) return;
      if (error || !data.session) throw new Error('No Supabase session. Connect again.');
      const current = new WebSocket(serverUrl);
      socket = current;
      sessionId = null;
      sequence = 0;
      movement = { x: 0, y: 0 };
      connectionTimer = setTimeout(() => current.close(), 8000);
      current.onopen = () => {
        if (stopped || terminal || socket !== current) { current.close(); return; }
        current.send(JSON.stringify({ type: 'authenticate', version: PROTOCOL_VERSION, accessToken: data.session!.access_token, ...room }));
      };
      current.onmessage = event => {
        if (stopped || socket !== current || terminal) return;
        const message = typeof event.data === 'string' ? parseServerMessage(event.data) : null;
        if (!message) { terminal = true; update({ status: 'error', detail: 'Unsupported server response.' }); current.close(); return; }
        if (message.type === 'welcome') {
          if (connectionTimer) clearTimeout(connectionTimer);
          sessionId = message.sessionId;
          sequence = 0; movement = { x: 0, y: 0 }; replayGeneration = null;
          attempts = 0;
          authFailures = 0;
          update({ status: 'connected', detail: 'Movement validated by the server', playerId: message.playerId, snapshot: null, abilityNotice: '', lifecycleNotice: '', replayPending: false });
          sendInput();
        } else if (message.type === 'snapshot') {
          if (view.snapshot?.epoch === message.epoch && message.tick < view.snapshot.tick) return;
          update({ snapshot: message });
        } else if (message.type === 'match_complete') {
          movement = { x: 0, y: 0 };
        } else if (message.type === 'lifecycle_rejected') {
          replayGeneration = null;
          const notices = { HOST_ONLY: 'Only the current host can control the run.', INVALID_TRANSITION: 'This action is unavailable in the current match state.', STALE_MATCH: 'The match changed. Try again after reconnecting.', NOT_READY: 'At least two connected players are required to replay.', BUSY: 'A replay request is already pending.', ROOM_UNAVAILABLE: 'Room authority unavailable. Try again shortly.' };
          update({ lifecycleNotice: notices[message.reason], replayPending: false });
        } else if (message.type === 'ability_rejected') {
          update({ abilityNotice: message.reason === 'MATCH_ENDED' ? 'Match complete. Wait for replay or return to the lobby.' : message.reason === 'EXTRACTED' ? 'Extracted. Wait for results.' : message.reason === 'DEAD' ? 'Respawning. Abilities return when you are alive.' : message.reason === 'NO_DIRECTION' ? 'Move first, then Dash within one second.' : `${message.ability === 'dash' ? 'Dash' : 'Shield'} is cooling down.` });
        } else if (message.type === 'error') {
          terminal = !['SERVER_CLOSING', 'AUTH_UNAVAILABLE', 'ROOM_UNAVAILABLE'].includes(message.code);
          if (message.code === 'INVALID_SESSION' && authFailures++ === 0) {
            terminal = false;
            refreshAuth = true;
          }
          update({ status: terminal ? 'error' : 'reconnecting', detail: `${message.code}: ${message.message}` });
        }
      };
      current.onerror = () => {
        if (!stopped && !terminal && socket === current) update({ detail: 'WebSocket transport failed. Check server readiness and upgrade diagnostics.' });
      };
      current.onclose = event => {
        if (socket !== current) return;
        if (connectionTimer) clearTimeout(connectionTimer);
        sessionId = null;
        movement = { x: 0, y: 0 };
        if (stopped || terminal) return;
        update({ status: 'reconnecting', detail: `Connection closed (${event.code}). Retrying… Check server readiness and upgrade diagnostics.` });
        const delay = Math.min(500 * 2 ** attempts++, 8000) + Math.random() * 250;
        retryTimer = setTimeout(() => { retryTimer = null; void open(); }, delay);
      };
    } catch (error) {
      if (!stopped) update({ status: 'error', detail: error instanceof Error ? error.message : 'Connection failed.' });
    } finally { opening = false; }
  }
  update({});
  void open();
  const cleanup = () => {
    // Send a final neutral input before detaching and closing.
    movement = { x: 0, y: 0 };
    sendInput();
    stopped = true;
    detachKeyboard();
    subscription.unsubscribe();
    clearInterval(inputTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (connectionTimer) clearTimeout(connectionTimer);
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); }
  };
  return Object.assign(cleanup, { activateAbility: sendAbility, replay: () => lifecycle('replay'), returnLobby: () => lifecycle('return') });
}
