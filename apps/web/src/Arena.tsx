import { useEffect, useRef } from 'react';
import type { Snapshot, Vector } from '@neon/protocol';
import { ARENA } from '@neon/simulation';

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
      const active = new Set(current.snapshot?.players.map(player => player.id));
      for (const id of positions.keys()) if (!active.has(id)) positions.delete(id);
      for (const player of current.snapshot?.players ?? []) {
        const position = positions.get(player.id) ?? { ...player.position };
        const alpha = 1 - Math.exp(-22 * dt);
        position.x += (player.position.x - position.x) * alpha;
        position.y += (player.position.y - position.y) * alpha;
        positions.set(player.id, position);
        context!.globalAlpha = player.connected ? 1 : 0.35;
        context!.fillStyle = PLAYER_COLORS[player.slot - 1]!;
        context!.beginPath();
        context!.arc(position.x, position.y, ARENA.radius, 0, Math.PI * 2);
        context!.fill();
        if (player.id === current.playerId) {
          context!.strokeStyle = '#ffffff'; context!.lineWidth = 2;
          context!.beginPath(); context!.arc(position.x, position.y, ARENA.radius + 5, 0, Math.PI * 2); context!.stroke();
        }
        context!.font = 'bold 14px system-ui'; context!.textAlign = 'center';
        context!.fillText(`P${player.slot}${player.id === current.playerId ? ' · YOU' : ''}`, position.x, position.y - 28);
        context!.globalAlpha = 1;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} width={ARENA.width} height={ARENA.height} aria-label="Temporary movement arena. Your player has a white ring. Use WASD or arrow keys." />;
}
