import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { browserConfiguration, createBrowserAuth } from './auth';
import { connectGame } from './connection';
import type { ConnectionView } from './connection';
import { Arena, PLAYER_COLORS } from './Arena';
import './style.css';

const initial: ConnectionView = { status: 'disconnected', detail: 'Connect to enter the movement test.', playerId: null, snapshot: null };
export function App() {
  const [view, setView] = useState(initial);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const auth = useRef<SupabaseClient | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; cleanup.current?.(); auth.current?.auth.stopAutoRefresh(); };
  }, []);
  async function join() {
    const current = ++generation.current;
    setJoining(true);
    setView({ ...initial, status: 'connecting', detail: 'Creating a secure player session…' });
    try {
      const config = browserConfiguration();
      auth.current ??= createBrowserAuth(config.url, config.key);
      auth.current.auth.startAutoRefresh();
      const existing = await auth.current.auth.getSession();
      if (existing.error) throw existing.error;
      if (!existing.data.session) {
        const { error } = await auth.current.auth.signInAnonymously();
        if (error) throw new Error(`Supabase Auth: ${error.message}. Check anonymous sign-in configuration.`);
      }
      if (!mounted.current || generation.current !== current) return;
      cleanup.current?.();
      cleanup.current = connectGame(auth.current, config.serverUrl, setView);
      setJoined(true);
    } catch (error) {
      if (mounted.current && generation.current === current) setView({ ...initial, status: 'error', detail: error instanceof Error ? error.message : 'Unable to connect.' });
    } finally { if (mounted.current && generation.current === current) setJoining(false); }
  }
  function leave() {
    generation.current++;
    cleanup.current?.(); cleanup.current = null;
    auth.current?.auth.stopAutoRefresh();
    setJoined(false); setJoining(false); setView(initial);
  }
  const players = view.snapshot?.players ?? [];
  return <main>
    <header><div><p className="eyebrow">PHASE 01 / MULTIPLAYER LAB</p><h1>NEON GRID<span>CYBER HEIST</span></h1></div><span className="tag">MOVEMENT PROOF</span></header>
    <section className="connection" aria-label="Connection">
      <div><span className={`indicator ${view.status}`} /><strong data-testid="connection-status" role="status">{view.status}</strong><p>{view.detail}</p></div>
      {joined ? <button onClick={leave}>Disconnect</button> : <button onClick={() => { void join(); }} disabled={joining}>{joining ? 'Connecting…' : 'Connect player'}</button>}
    </section>
    <div className="layout"><section className="arena-panel"><div className="panel-label"><span>TEST ARENA / SHARED SERVER</span><span>{players.filter(p => p.connected).length} / 4 ONLINE</span></div><Arena snapshot={view.snapshot} playerId={view.playerId} /><p className="controls"><kbd>W A S D</kbd> or <kbd>↑ ← ↓ →</kbd> to move · White ring = you</p></section>
      <aside><h2>Connected players</h2><p className="small">Server-issued identities. Positions below are authoritative.</p><ul aria-label="Players">{players.map(player => <li key={player.id} data-testid="player" data-player-id={player.id} data-self={player.id === view.playerId} data-x={player.position.x} data-y={player.position.y} data-connected={player.connected}>
        <div className="player-name"><span className="swatch" style={{ background: PLAYER_COLORS[player.slot - 1] }} /><strong>P{player.slot}{player.id === view.playerId ? ' · YOU' : ''}</strong><span className="small">{player.connected ? 'online' : 'reconnecting'}</span></div><code>{player.id}</code><span className="coordinates">x {player.position.x.toFixed(1)} / y {player.position.y.toFixed(1)}</span>
      </li>)}</ul>{!players.length && <p className="small">Connect in two separate browser sessions to test shared movement.</p>}<div className="note"><strong>Foundation only</strong><p>No objectives or abilities yet. This arena proves server authority and synchronized movement.</p></div></aside>
    </div><footer>30 Hz simulation · 15 Hz snapshots · Supabase identity · Canvas 2D</footer>
  </main>;
}
