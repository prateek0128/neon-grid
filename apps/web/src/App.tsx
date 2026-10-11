import { ExtractionHud } from './ExtractionHud';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoomSnapshot } from '@neon/protocol';
import { AuthenticationError, browserConfiguration, browserSession, createBrowserAuth, ensureBrowserIdentity } from './auth';
import { RoomError, roomRpc } from './room-client';
import { connectGame } from './connection';
import type { ConnectionView } from './connection';
import { Arena, PLAYER_COLORS } from './Arena';
import { MovementTest } from './MovementTest';
import { AbilityHud } from './AbilityHud';
import { Results } from './Results';
import { HealthBadge, HealthHud } from './HealthHud';
import { CORE_RULES } from '@neon/simulation';
import { TICK_RATE } from '@neon/protocol';
import './style.css';

const disconnected: ConnectionView = { status: 'disconnected', detail: 'Waiting for the host to start.', playerId: null, snapshot: null };
export function App() {
  if (import.meta.env.DEV && location.pathname === '/movement-test') return <MovementTest />;
  return <RoomApp />;
}
function RoomApp() {
  const [name, setName] = useState(() => sessionStorage.getItem('neon-grid-name') ?? '');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<ConnectionView>(disconnected);
  const auth = useRef<SupabaseClient | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const mounted = useRef(true);
  const socketCleanup = useRef<ReturnType<typeof connectGame> | null>(null);
  const pollInFlight = useRef(false);
  const operationInFlight = useRef(false);
  const authPollingPaused = useRef(false);
  const generation = useRef(0);

  function installRoom(next: RoomSnapshot | null) {
    if (next?.id !== roomRef.current?.id) setCopied(false);
    roomRef.current = next;
    setRoom(next);
    if (next) sessionStorage.setItem('neon-grid-room', next.id);
    else sessionStorage.removeItem('neon-grid-room');
  }
  async function identity() {
    const config = browserConfiguration();
    auth.current ??= createBrowserAuth(config.url, config.key);
    await ensureBrowserIdentity(auth.current);
    return auth.current;
  }
  async function refresh() {
    if (!auth.current || authPollingPaused.current || pollInFlight.current || operationInFlight.current) return;
    pollInFlight.current = true;
    const currentGeneration = generation.current;
    try {
      if (!await browserSession(auth.current)) {
        if (roomRef.current) throw new AuthenticationError('Your session ended. Reload and try Create Room or Join Room again.');
        return;
      }
      const next = await roomRpc(auth.current, 'ng_get_room', { p_room_id: roomRef.current?.id ?? null });
      if (mounted.current && currentGeneration === generation.current && !operationInFlight.current) {
        if (!roomRef.current || !next || next.revision >= roomRef.current.revision) installRoom(next);
        setError('');
      }
    } catch (cause) {
      if (!mounted.current || currentGeneration !== generation.current) return;
      if (cause instanceof AuthenticationError) authPollingPaused.current = true;
      if (cause instanceof RoomError && ['NOT_MEMBER','ROOM_MISSING','ROOM_EXPIRED'].includes(cause.code)) {
        if (roomRef.current || sessionStorage.getItem('neon-grid-room')) setError(cause.message);
        installRoom(null); socketCleanup.current?.(); socketCleanup.current = null;
      } else setError(cause instanceof Error ? cause.message : 'Connection interrupted.');
    } finally { pollInFlight.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function restore() {
      try {
        const config = browserConfiguration();
        auth.current ??= createBrowserAuth(config.url, config.key);
        auth.current.auth.startAutoRefresh();
        const session = await browserSession(auth.current);
        if (session && !cancelled) await refresh();
      } catch (cause) {
        if (!cancelled) {
          authPollingPaused.current = true;
          setError(cause instanceof Error ? cause.message : 'Session recovery failed. Please try again.');
        }
      }
      finally { if (!cancelled) setRecovering(false); }
    }
    void restore();
    const timer = setInterval(() => { void refresh(); }, 2000);
    const online = () => { void refresh(); };
    window.addEventListener('online', online);
    return () => {
      cancelled = true; mounted.current = false; generation.current++;
      clearInterval(timer); window.removeEventListener('online', online);
      socketCleanup.current?.(); auth.current?.auth.stopAutoRefresh();
    };
  }, []);
  useEffect(() => {
    socketCleanup.current?.(); socketCleanup.current = null;
    setView(disconnected);
    if (room?.status !== 'IN_MATCH' || !room.match || !auth.current) return;
    const config = browserConfiguration();
    const cleanup = connectGame(auth.current, config.serverUrl, setView, { roomId: room.id, matchId: room.match.id });
    socketCleanup.current = cleanup;
    return cleanup;
  }, [room?.id, room?.status, room?.match?.id]);

  async function action(kind: 'create' | 'join' | 'ready' | 'start' | 'leave' | 'return') {
    if (operationInFlight.current) return;
    if (kind === 'return' && roomRef.current?.status === 'IN_MATCH' && socketCleanup.current && view.snapshot?.gameplay?.match) { socketCleanup.current.returnLobby(); return; }
    operationInFlight.current = true; generation.current++;
    setBusy(true); setError('');
    try {
      const client = await identity();
      authPollingPaused.current = false;
      let current = roomRef.current;
      if (!['create','join','leave'].includes(kind) && current) {
        current = await roomRpc(client, 'ng_get_room', { p_room_id: current.id });
      }
      const params: Record<string, unknown> = { p_request_id: crypto.randomUUID() };
      if (kind === 'create' || kind === 'join') {
        params.p_name = name.trim(); sessionStorage.setItem('neon-grid-name', name.trim());
        if (kind === 'join') params.p_code = code.trim().toUpperCase();
      } else {
        if (!current) throw new Error('Room state unavailable. Refresh first.');
        params.p_room_id = current.id;
        if (kind !== 'leave') params.p_revision = current.revision;
        if (kind === 'ready') params.p_ready = !current.members.find(m => m.id === current.selfMemberId)?.ready;
      }
      const rpcNames = { create: 'ng_create_room', join: 'ng_join_room', ready: 'ng_set_ready', start: 'ng_request_start', leave: 'ng_leave_room', return: 'ng_return_lobby' };
      const next = await roomRpc(client, rpcNames[kind], params);
      if (mounted.current) installRoom(next);
    } catch (cause) {
      if (cause instanceof AuthenticationError) authPollingPaused.current = true;
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Request failed.');
      if (cause instanceof RoomError && cause.code === 'REVISION_CONFLICT' && auth.current) {
        try { const next = await roomRpc(auth.current, 'ng_get_room', { p_room_id: roomRef.current?.id }); if (mounted.current) installRoom(next); } catch { /* Keep the original error. */ }
      }
    } finally { operationInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const self = room?.members.find(member => member.id === room.selfMemberId);
  const gameplay = view.snapshot?.gameplay;
  const match = gameplay?.match;
  const results = match?.results;
  const collection = gameplay?.events.at(-1);
  const recentCollection = collection && gameplay && gameplay.tick - collection.tick <= TICK_RATE * 2 ? collection : null;
  const host = room?.hostMemberId === room?.selfMemberId;
  const canStart = room?.members.length && room.members.length >= 2 && room.members.every(m => m.ready && m.online);
  async function copyCode() {
    try { await navigator.clipboard.writeText(room!.code); setCopied(true); }
    catch { setError('Copy unavailable. Select and copy the room code manually.'); }
  }
  return <main className="room-app">
    <header><div><p className="eyebrow">PRIVATE CREW / SHARED GRID</p><h1>NEON GRID<span>CYBER HEIST</span></h1></div><span className="tag">PHASE 03D · COMPLETE THE HEIST</span></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {recovering ? <p role="status">Restoring your session…</p> : !room ? <section className="landing">
      <div className="landing-story"><p className="eyebrow">ASSEMBLE YOUR CREW</p><h2>The grid is better<br />with company.</h2><p>Bring up to four players into a private room. Get ready, link in, and move together.</p><p className="small">Collect gold cores together on the shared grid. Chain pickups within five seconds to build a 3× combo.</p><div className="landing-grid" aria-hidden="true" /></div>
      <div className="entry-card"><label htmlFor="display-name">Your callsign</label><input id="display-name" value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="e.g. Cipher" autoComplete="nickname" />
        <button disabled={busy || !name.trim()} onClick={()=>{void action('create');}}>Create Room</button><div className="entry-divider">OR JOIN YOUR CREW</div>
        <label htmlFor="room-code">Room code</label><input id="room-code" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="12-character code" autoComplete="off" spellCheck={false} />
        <button className="secondary" disabled={busy || !name.trim() || code.trim().length!==12} onClick={()=>{void action('join');}}>Join Room</button><p className="small">No account form. A secure anonymous identity connects your session.</p>
      </div></section> : <>
      <section className="room-bar"><div><p className="eyebrow">PRIVATE ROOM CODE</p><strong className="room-code" data-testid="room-code">{room.code}</strong></div><button className="secondary" onClick={()=>{void copyCode();}}>{copied ? 'Copied' : 'Copy code'}</button><span className="room-state" data-testid="room-status">{results ? 'RESULTS' : room.status.replace('_',' ')}</span><button className="quiet" disabled={busy} onClick={()=>{void action('leave');}}>Leave Room</button></section>
      {room.lastError && <p className="error-banner" role="status">{room.lastError}</p>}
      <div className="layout"><section className="arena-panel">{room.status==='IN_MATCH' ? <><div className="panel-label"><span>{results ? 'FINAL RESULTS' : 'CORE COLLECTION'}</span><span role="status" data-testid="connection-status">{view.status}</span></div><>{results ? <Results results={results} members={room.members} selfId={room.selfMemberId} /> : <><p className="match-clock" data-testid="match-clock">{match ? `${Math.max(0, Math.ceil((match.durationTicks - gameplay!.tick) / TICK_RATE))}s remaining` : "Linking match clock…"}</p><ExtractionHud gameplay={gameplay} playerId={view.playerId} /><Arena snapshot={view.snapshot} playerId={view.playerId} /><HealthHud gameplay={gameplay} playerId={view.playerId} /><AbilityHud gameplay={gameplay} playerId={view.playerId} connected={view.status === "connected"} notice={view.abilityNotice} onActivate={ability => socketCleanup.current?.activateAbility(ability)} /><p className="collection-event" role="status" data-testid="collection-event">{recentCollection ? `${room.members.find(m => m.id === recentCollection.playerId)?.displayName ?? "Crew member"} collected a core · +${recentCollection.points} · ${recentCollection.multiplier}×` : `Gold cores · ${CORE_RULES.basePoints} base points · chain pickups within 5 seconds`}</p><ul className="core-data" aria-hidden="true">{gameplay?.cores.filter(c => c.active).map(c => <li key={c.id} data-testid="core" data-core-id={c.id} data-x={c.position.x} data-y={c.position.y}>{c.id}</li>)}</ul><p className="controls"><kbd>W A S D</kbd> or <kbd>↑ ← ↓ →</kbd> to move · White ring = you</p><p className="small session-detail">{view.detail}</p><ul className="movement-data" aria-label="Authoritative positions">{view.snapshot?.players.map(player=><li key={player.id} data-testid="player" data-player-id={player.id} data-self={player.id===view.playerId} data-x={player.position.x} data-y={player.position.y} data-connected={player.connected} data-health={gameplay?.vitals?.find(v => v.id === player.id)?.health ?? ""} data-life={gameplay?.vitals?.find(v => v.id === player.id)?.life ?? "alive"} data-shield-active={!!gameplay?.abilities?.some(a => a.id === player.id && gameplay.tick < a.shieldUntilTick)} data-dash-active={!!gameplay?.abilities?.some(a => a.id === player.id && gameplay.tick < a.dashUntilTick)}>P{player.slot} · {player.position.x.toFixed(1)}, {player.position.y.toFixed(1)}</li>)}</ul></>}</></> : <div className="lobby-message"><p className="eyebrow">CREW STAGING</p><h2>{room.status==='STARTING' ? 'Linking your crew…' : 'Ready when you are.'}</h2><p>{room.status==='STARTING' ? 'The game server is validating the roster and start request.' : 'Share your room code. Everyone readies up before the host starts.'}</p><div className="lobby-grid" aria-hidden="true" /></div> }</section>
      <aside><h2>Your crew · {room.members.length}/4</h2><ul aria-label="Room roster">{room.members.map(member=><li key={member.id} data-testid="roster-member" data-member-id={member.id}><div className="player-name"><span className="swatch" style={{background:PLAYER_COLORS[member.slot-1]}} /><strong>{member.displayName}{member.id===room.selfMemberId ? ' · YOU' : ''}</strong></div>{room.status === "IN_MATCH" && <div className={`player-score ${member.id === room.selfMemberId ? "local-score" : ""}`} data-testid="score" data-member-id={member.id} data-score={gameplay?.scores.find(s => s.id === member.id)?.score ?? ""}><strong>{gameplay?.scores.find(s => s.id === member.id)?.score ?? "—"} pts</strong><span>{results ? "Final score" : <>{gameplay?.scores.find(s => s.id === member.id)?.multiplier ?? 1}× · combo {gameplay?.scores.find(s => s.id === member.id)?.combo ?? 0}</>}</span></div>}{room.status === "IN_MATCH" && !results && <HealthBadge vital={gameplay?.vitals?.find(v => v.id === member.id)} tick={gameplay?.tick ?? 0} />}<p className="small" data-testid="extraction-player" data-member-id={member.id}>{gameplay?.extraction?.players.find(p => p.id === member.id)?.outcome.replaceAll("_", " ")}</p><div className="roster-flags">{member.id===room.hostMemberId && <span className="host-badge">HOST</span>}<span>{member.ready ? 'READY' : 'NOT READY'}</span></div></li>)}</ul>
        {room.status==='LOBBY' && <><button className="full-width" disabled={busy} onClick={()=>{void action('ready');}}>{self?.ready ? 'Unready' : 'Ready up'}</button>{host ? <button className="secondary full-width" disabled={busy || !canStart} onClick={()=>{void action('start');}}>Start Match</button> : <p className="small">The host starts when everyone is ready.</p>}</>}
        {room.status==='IN_MATCH' && results && host && <button className="full-width" disabled={busy || view.status !== 'connected' || view.replayPending} onClick={() => socketCleanup.current?.replay()}>Play Again</button>}
        {view.lifecycleNotice && <p className="error-banner" role="alert">{view.lifecycleNotice}</p>}
        {room.status==='IN_MATCH' && host && <button className="secondary full-width" disabled={busy || view.replayPending || view.status !== 'connected'} onClick={()=>{void action('return');}}>Return to Lobby</button>}
        <p className="small">{room.status==='IN_MATCH' ? 'Scores and cores are server-controlled. Returning to lobby clears this run for the crew.' : 'At least two players are required. Joining resets readiness.'}</p>
      </aside></div></>}
    <footer>Private rooms · Server authority · No gameplay state written by clients</footer>
  </main>;
}
