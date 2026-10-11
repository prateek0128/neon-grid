import type { SupabaseClient } from '@supabase/supabase-js';
import { PROTOCOL_VERSION, TICK_RATE, parseServerMessage } from '@neon/protocol';
import type { AbilityKind, Snapshot, Vector } from '@neon/protocol';
import { attachKeyboard } from './keyboard';

export type ConnectionView = { status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'; detail: string; playerId: string | null; snapshot: Snapshot | null; abilityNotice?: string };
export function connectGame(auth: SupabaseClient, serverUrl: string, onView: (view: ConnectionView) => void, room?: { roomId: string; matchId: string }) {
  let stopped = false;
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
  function sendInput() {
    if (!stopped && socket?.readyState === WebSocket.OPEN && sessionId && !terminal) {
      socket.send(JSON.stringify({ type: 'input', version: PROTOCOL_VERSION, sessionId, sequence: sequence++, movement }));
    }
  }
  function sendAbility(ability: AbilityKind) {
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
    try {
      if (refreshAuth) {
        refreshAuth = false;
        const renewed = await auth.auth.refreshSession();
        if (renewed.error || !renewed.data.session) throw new Error('Session expired. Reload to authenticate again.');
      }
      const { data, error } = await auth.auth.getSession();
      if (stopped) return;
      if (error || !data.session) throw new Error('No Supabase session. Connect again.');
      const current = new WebSocket(serverUrl);
      socket = current;
      sessionId = null;
      sequence = 0;
      movement = { x: 0, y: 0 };
      connectionTimer = setTimeout(() => current.close(), 8000);
      current.onopen = () => {
        current.send(JSON.stringify({ type: 'authenticate', version: PROTOCOL_VERSION, accessToken: data.session!.access_token, ...room }));
      };
      current.onmessage = event => {
        if (stopped || socket !== current || terminal) return;
        const message = typeof event.data === 'string' ? parseServerMessage(event.data) : null;
        if (!message) { terminal = true; update({ status: 'error', detail: 'Unsupported server response.' }); current.close(); return; }
        if (message.type === 'welcome') {
          if (connectionTimer) clearTimeout(connectionTimer);
          sessionId = message.sessionId;
          attempts = 0;
          authFailures = 0;
          update({ status: 'connected', detail: 'Movement validated by the server', playerId: message.playerId, snapshot: null, abilityNotice: '' });
          sendInput();
        } else if (message.type === 'snapshot') {
          if (view.snapshot?.epoch === message.epoch && message.tick < view.snapshot.tick) return;
          update({ snapshot: message });
        } else if (message.type === 'ability_rejected') {
          update({ abilityNotice: message.reason === 'DEAD' ? 'Respawning. Abilities return when you are alive.' : message.reason === 'NO_DIRECTION' ? 'Move first, then Dash within one second.' : `${message.ability === 'dash' ? 'Dash' : 'Shield'} is cooling down.` });
        } else if (message.type === 'error') {
          terminal = !['SERVER_CLOSING', 'AUTH_UNAVAILABLE', 'ROOM_UNAVAILABLE'].includes(message.code);
          if (message.code === 'INVALID_SESSION' && authFailures++ === 0) {
            terminal = false;
            refreshAuth = true;
          }
          update({ status: terminal ? 'error' : 'reconnecting', detail: `${message.code}: ${message.message}` });
        }
      };
      current.onerror = () => { /* Close drives retry; no token-bearing error output. */ };
      current.onclose = () => {
        if (connectionTimer) clearTimeout(connectionTimer);
        sessionId = null;
        movement = { x: 0, y: 0 };
        if (stopped || terminal) return;
        update({ status: 'reconnecting', detail: 'Connection interrupted. Retrying…' });
        const delay = Math.min(500 * 2 ** attempts++, 8000) + Math.random() * 250;
        retryTimer = setTimeout(() => { void open(); }, delay);
      };
    } catch (error) {
      if (!stopped) update({ status: 'error', detail: error instanceof Error ? error.message : 'Connection failed.' });
    }
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
  return Object.assign(cleanup, { activateAbility: sendAbility });
}
