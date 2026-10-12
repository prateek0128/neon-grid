import { useEffect, useRef } from 'react';
import type { Snapshot, Vector } from '@neon/protocol';
import { ARENA, CORE_RULES } from '@neon/simulation';
import { TICK_RATE } from '@neon/protocol';

export const PLAYER_COLORS = ['#56f0d0', '#c9a7ff', '#ffc875', '#80bdff'];
export function Arena({ snapshot, playerId }: { snapshot: Snapshot | null; playerId: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ snapshot, playerId });
  useEffect(() => { latest.current = { snapshot, playerId }; }, [snapshot, playerId]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    let frame = 0;
    let previous = performance.now();
    let epoch: string | null = null;
    const positions = new Map<string, Vector>();
    function render(now: number) {
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const current = latest.current;
      if (epoch !== current.snapshot?.epoch) { positions.clear(); epoch = current.snapshot?.epoch ?? null; }
      context!.fillStyle = '#0b1120';
      context!.fillRect(0, 0, ARENA.width, ARENA.height);
      context!.strokeStyle = '#19253a';
      context!.lineWidth = 1;
      context!.beginPath();
      for (let x = 0; x <= ARENA.width; x += 40) { context!.moveTo(x, 0); context!.lineTo(x, ARENA.height); }
      for (let y = 0; y <= ARENA.height; y += 40) { context!.moveTo(0, y); context!.lineTo(ARENA.width, y); }
      context!.stroke();
      context!.strokeStyle = '#395266';
      context!.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2);
      const extraction = current.snapshot?.gameplay?.extraction;
      if (extraction) {
        context!.fillStyle = extraction.phase === 'open' ? '#29e6c433' : '#9274ff18';
        context!.strokeStyle = extraction.phase === 'open' ? '#29e6c4' : '#9274ff';
        context!.lineWidth = 3; context!.beginPath();
        context!.arc(extraction.zone.x, extraction.zone.y, extraction.zone.radius, 0, Math.PI * 2);
        context!.fill(); context!.stroke(); context!.fillStyle = '#e0fff8';
        context!.font = 'bold 14px system-ui'; context!.textAlign = 'center';
        context!.fillText(extraction.phase === 'open' ? 'EXTRACT' : 'EXIT', extraction.zone.x, extraction.zone.y + 5);
      }
      const gameplay = current.snapshot?.gameplay;
      for (const laser of gameplay?.hazards ?? []) {
        if (laser.phase === 'idle') continue;
        const vertical = laser.axis === 'x';
        if (laser.motion) {
          const low = Math.min(laser.motion.from, laser.motion.to); const width = Math.abs(laser.motion.to - laser.motion.from);
          context!.fillStyle = laser.phase === 'warning' ? '#ffc87524' : '#ff527410';
          context!.fillRect(vertical ? low : 0, vertical ? 0 : low, vertical ? width : ARENA.width, vertical ? ARENA.height : width);
          context!.strokeStyle = laser.phase === 'warning' ? '#ffc875' : '#ff527480';
          context!.lineWidth = 2; context!.setLineDash([8, 8]);
          context!.strokeRect(vertical ? low : 1, vertical ? 1 : low, vertical ? width : ARENA.width - 2, vertical ? ARENA.height - 2 : width);
          context!.setLineDash([]);
          context!.fillStyle = laser.phase === 'warning' ? '#ffc875' : '#ff9aaa'; context!.font = 'bold 24px system-ui'; context!.textAlign = 'center';
          context!.fillText(vertical ? (laser.motion.direction === 1 ? '→' : '←') : (laser.motion.direction === 1 ? '↓' : '↑'), vertical ? (laser.motion.from + laser.motion.to) / 2 : ARENA.width / 2, vertical ? ARENA.height / 2 : (laser.motion.from + laser.motion.to) / 2);
        }
        context!.strokeStyle = laser.phase === 'warning' ? '#ffc875' : '#ff5274';
        context!.lineWidth = laser.phase === 'warning' ? 2 : 10;
        context!.setLineDash(laser.phase === 'warning' ? [10, 8] : []);
        context!.beginPath(); context!.moveTo(vertical ? laser.coordinate : 0, vertical ? 0 : laser.coordinate);
        context!.lineTo(vertical ? laser.coordinate : ARENA.width, vertical ? ARENA.height : laser.coordinate); context!.stroke();
        context!.setLineDash([]);
        if (laser.phase === 'active') {
          // White core increases contrast; the red outer band retains the actual ten-pixel beam width.
          context!.strokeStyle = '#fff1f4'; context!.lineWidth = 2; context!.stroke();
        }
        context!.fillStyle = laser.phase === 'warning' ? '#ffc875' : '#ff9aaa';
        const labelLeft = vertical && laser.coordinate > ARENA.width - 160;
        context!.font = 'bold 12px system-ui'; context!.textAlign = labelLeft ? 'right' : 'left';
        context!.fillText(laser.phase === 'warning' ? (laser.motion ? 'SWEEP WARNING' : 'LASER WARNING') : (laser.motion ? 'ACTIVE SWEEP' : 'ACTIVE LASER'), vertical ? laser.coordinate + (labelLeft ? -12 : 12) : 16, vertical ? 30 : laser.coordinate - 10);
      }
      for (const core of gameplay?.cores ?? []) {
        if (!core.active) continue;
        const { x, y } = core.position;
        context!.fillStyle = '#ffe786'; context!.strokeStyle = '#917542'; context!.lineWidth = 2;
        context!.beginPath(); context!.moveTo(x, y - CORE_RULES.radius); context!.lineTo(x + CORE_RULES.radius, y);
        context!.lineTo(x, y + CORE_RULES.radius); context!.lineTo(x - CORE_RULES.radius, y); context!.closePath();
        context!.fill(); context!.stroke();
      }
      for (const event of gameplay?.events ?? []) {
        const age = (gameplay!.tick - event.tick) / TICK_RATE;
        if (age > 0.7) continue;
        context!.globalAlpha = 1 - age / 0.7;
        context!.strokeStyle = '#ffe786'; context!.lineWidth = 2;
        context!.beginPath(); context!.arc(event.position.x, event.position.y, 10 + age * 45, 0, Math.PI * 2); context!.stroke();
        context!.fillStyle = '#ffe786'; context!.font = 'bold 14px system-ui'; context!.textAlign = 'center';
        context!.fillText(`+${event.points}`, event.position.x, event.position.y - 18 - age * 30);
        context!.globalAlpha = 1;
      }
      const active = new Set(current.snapshot?.players.map(player => player.id));
      for (const id of positions.keys()) if (!active.has(id)) positions.delete(id);
      for (const player of current.snapshot?.players ?? []) {
        const position = positions.get(player.id) ?? { ...player.position };
        const alpha = 1 - Math.exp(-22 * dt);
        position.x += (player.position.x - position.x) * alpha;
        position.y += (player.position.y - position.y) * alpha;
        positions.set(player.id, position);
        const ability = gameplay?.abilities?.find(a => a.id === player.id);
        const vital = gameplay?.vitals?.find(v => v.id === player.id);
        const healthEvent = gameplay?.healthEvents?.findLast(e => e.playerId === player.id && ['damage', 'shield_blocked', 'invulnerable_blocked'].includes(e.kind));
        if (healthEvent && gameplay && gameplay.tick - healthEvent.tick < TICK_RATE * 0.7) {
          context!.strokeStyle = healthEvent.kind === 'damage' ? '#ff5274' : '#b7dfff'; context!.lineWidth = 4;
          context!.beginPath(); context!.arc(position.x, position.y, ARENA.radius + 16, 0, Math.PI * 2); context!.stroke();
          context!.fillStyle = context!.strokeStyle; context!.font = 'bold 12px system-ui'; context!.textAlign = 'center';
          context!.fillText(healthEvent.kind === 'damage' ? `−${healthEvent.amount} HP` : 'BLOCK', position.x, position.y + 40);
        }
        if (vital && gameplay && gameplay.tick < vital.invulnerableUntilTick) {
          context!.strokeStyle = '#ffffff'; context!.lineWidth = 2; context!.setLineDash([4, 5]);
          context!.beginPath(); context!.arc(position.x, position.y, ARENA.radius + 15, 0, Math.PI * 2); context!.stroke(); context!.setLineDash([]);
        }
        const dashEvent = gameplay?.abilityEvents?.findLast(e => e.playerId === player.id && e.ability === 'dash');
        if (ability && gameplay && (gameplay.tick < ability.dashUntilTick || (dashEvent && gameplay.tick - dashEvent.tick < TICK_RATE * 0.35))) {
          context!.strokeStyle = PLAYER_COLORS[player.slot - 1]!; context!.lineWidth = 8; context!.globalAlpha = 0.5;
          context!.beginPath(); context!.moveTo(position.x, position.y);
          context!.lineTo(position.x - ability.dashDirection.x * 45, position.y - ability.dashDirection.y * 45); context!.stroke();
          context!.globalAlpha = 1;
        }
        if (ability && gameplay && gameplay.tick < ability.shieldUntilTick) {
          context!.strokeStyle = '#80bdff'; context!.lineWidth = 3;
          context!.beginPath(); context!.arc(position.x, position.y, ARENA.radius + 11, 0, Math.PI * 2); context!.stroke();
        }
        context!.globalAlpha = vital?.life === 'respawning' ? 0.2 : player.connected ? 1 : 0.35;
        context!.fillStyle = PLAYER_COLORS[player.slot - 1]!;
        context!.beginPath();
        context!.arc(position.x, position.y, ARENA.radius, 0, Math.PI * 2);
        context!.fill();
        if (player.id === current.playerId) {
          context!.strokeStyle = '#ffffff'; context!.lineWidth = 2;
          context!.beginPath(); context!.arc(position.x, position.y, ARENA.radius + 5, 0, Math.PI * 2); context!.stroke();
        }
        context!.font = 'bold 14px system-ui'; context!.textAlign = 'center';
        context!.globalAlpha = 1;
        context!.fillText(gameplay?.extraction?.players.find(p => p.id === player.id)?.outcome === 'extracted' ? `P${player.slot} · EXTRACTED` : vital?.life === 'respawning' && gameplay ? `RESPAWN ${Math.max(0, Math.ceil((vital.respawnAtTick - gameplay.tick) / TICK_RATE))}s` : `P${player.slot}${player.id === current.playerId ? ' · YOU' : ''}`, position.x, position.y - 28);
        context!.globalAlpha = 1;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} width={ARENA.width} height={ARENA.height} aria-label="Shared grid arena. Your player has a white ring. Use WASD or arrow keys. Move onto gold energy cores to collect them." />;
}
