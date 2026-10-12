import type { Vector } from '@neon/protocol';

export type ArenaLayoutId = 'grid' | 'vault' | 'crossroads';
export type ArenaLayout = { id: ArenaLayoutId; label: string; extractionZone: { x: number; y: number; radius: number }; obstacles: { x: number; y: number; width: number; height: number }[] };
export const ARENA_LAYOUTS: readonly ArenaLayout[] = [
  { id: 'grid', label: 'Neon Grid', extractionZone: { x: 480, y: 320, radius: 60 }, obstacles: [] },
  { id: 'vault', label: 'Data Vault', extractionZone: { x: 480, y: 320, radius: 60 }, obstacles: [{ x: 650, y: 100, width: 100, height: 120 }, { x: 650, y: 420, width: 100, height: 120 }] },
  { id: 'crossroads', label: 'Crossroads', extractionZone: { x: 480, y: 320, radius: 60 }, obstacles: [{ x: 280, y: 400, width: 140, height: 80 }, { x: 540, y: 400, width: 140, height: 80 }] },
] as const;
export function layoutForGeneration(generation: string): ArenaLayout {
  const value = [...generation].reduce((total, character) => total + character.charCodeAt(0), 0);
  return ARENA_LAYOUTS[value % ARENA_LAYOUTS.length]!;
}
export function blocked(position: Vector, layout: ArenaLayout, radius = 14) {
  return layout.obstacles.some(box => position.x + radius > box.x && position.x - radius < box.x + box.width && position.y + radius > box.y && position.y - radius < box.y + box.height);
}
export function resolvePosition(position: Vector, movement: Vector, distance: number, layout: ArenaLayout) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  let current = { ...position };
  // Substeps prevent Dash from crossing a thin barrier between snapshots.
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let step = 0; step < steps; step++) {
    const full = { x: clamp(current.x + movement.x * distance / steps, 14, 946), y: clamp(current.y + movement.y * distance / steps, 14, 626) };
    if (!blocked(full, layout)) { current = full; continue; }
    const xOnly = { x: full.x, y: current.y };
    const yOnly = { x: current.x, y: full.y };
    if (!blocked(xOnly, layout)) current = xOnly;
    else if (!blocked(yOnly, layout)) current = yOnly;
    else break;
  }
  return current;
}
export function validLayoutPosition(position: Vector, layout: ArenaLayout) { return !blocked(position, layout); }
