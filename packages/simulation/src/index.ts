import type { Vector } from '@neon/protocol';

export const ARENA = { width: 960, height: 640, radius: 14, speed: 210 } as const;
export function normalizeMovement(movement: Vector): Vector {
  const length = Math.hypot(movement.x, movement.y);
  if (!Number.isFinite(length)) return { x: 0, y: 0 };
  return length > 1 ? { x: movement.x / length, y: movement.y / length } : { ...movement };
}
export function advancePosition(position: Vector, movement: Vector, deltaSeconds: number): Vector {
  const direction = normalizeMovement(movement);
  const distance = ARENA.speed * deltaSeconds;
  return {
    x: Math.max(ARENA.radius, Math.min(ARENA.width - ARENA.radius, position.x + direction.x * distance)),
    y: Math.max(ARENA.radius, Math.min(ARENA.height - ARENA.radius, position.y + direction.y * distance)),
  };
}
export function spawnPosition(slot: number): Vector {
  return { x: 320 + ((slot - 1) % 2) * 320, y: 220 + Math.floor((slot - 1) / 2) * 200 };
}
export * from './gameplay.ts';
