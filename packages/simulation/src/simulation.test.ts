import { describe, expect, it } from 'vitest';
import { advancePosition, ARENA, normalizeMovement } from './index.ts';

describe('authoritative movement', () => {
  it('moves the configured distance using fixed steps', () => {
    let position = { x: 100, y: 100 };
    for (let i = 0; i < 30; i++) position = advancePosition(position, { x: 1, y: 0 }, 1 / 30);
    expect(position).toEqual({ x: 310, y: 100 });
  });
  it('normalizes diagonals to the same speed as cardinal movement', () => {
    const position = advancePosition({ x: 100, y: 100 }, { x: 1, y: 1 }, 1 / 30);
    expect(Math.hypot(position.x - 100, position.y - 100)).toBeCloseTo(7);
    expect(normalizeMovement({ x: 1, y: 1 }).x).toBeCloseTo(Math.SQRT1_2);
  });
  it('stops exactly when neutral input is applied', () => {
    expect(advancePosition({ x: 100, y: 100 }, { x: 0, y: 0 }, 1 / 30)).toEqual({ x: 100, y: 100 });
  });
  it('keeps the full player radius inside arena boundaries', () => {
    expect(advancePosition({ x: 15, y: 15 }, { x: -1, y: -1 }, 1)).toEqual({ x: ARENA.radius, y: ARENA.radius });
    expect(advancePosition({ x: 945, y: 625 }, { x: 1, y: 1 }, 1)).toEqual({ x: 946, y: 626 });
  });
  it('preserves analog input below unit length', () => {
    expect(advancePosition({ x: 100, y: 100 }, { x: 0.5, y: 0 }, 1 / 30)).toEqual({ x: 103.5, y: 100 });
  });
});
