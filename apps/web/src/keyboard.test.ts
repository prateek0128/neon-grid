import { expect, it } from 'vitest';
import { movementFromKeys } from './keyboard';

it('supports WASD and arrow movement, diagonals, opposing keys and release', () => {
  expect(movementFromKeys(new Set(['KeyD', 'KeyW']))).toEqual({ x: 1, y: -1 });
  expect(movementFromKeys(new Set(['ArrowRight', 'ArrowDown']))).toEqual({ x: 1, y: 1 });
  expect(movementFromKeys(new Set(['KeyA', 'KeyD']))).toEqual({ x: 0, y: 0 });
  expect(movementFromKeys(new Set(['KeyD', 'ArrowRight']))).toEqual({ x: 1, y: 0 });
  expect(movementFromKeys(new Set())).toEqual({ x: 0, y: 0 });
});
