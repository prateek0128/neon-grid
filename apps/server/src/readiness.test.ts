import { expect, it } from 'vitest';
import { readinessCondition } from './readiness.ts';
const healthy = { closing: false, listening: true, hasRooms: true, allowTestArena: false, healthy: true, hasSuccessfulSync: true, hasFailure: false, now: 5000, lastSync: 0 };
it('preserves the exact five-second freshness boundary', () => {
  expect(readinessCondition(healthy)).toBe('ready');
  expect(readinessCondition({ ...healthy, now: 5001 })).toBe('authority_stale');
});
it('distinguishes pending, failed and recovered authority without exposing details', () => {
  expect(readinessCondition({ ...healthy, healthy: false, hasSuccessfulSync: false })).toBe('authority_pending');
  expect(readinessCondition({ ...healthy, healthy: false, hasSuccessfulSync: false, hasFailure: true })).toBe('authority_unhealthy');
  expect(readinessCondition({ ...healthy, healthy: false })).toBe('authority_unhealthy');
  expect(readinessCondition(healthy)).toBe('ready');
});
it('checks shutdown, listener and missing authority independently', () => {
  expect(readinessCondition({ ...healthy, closing: true })).toBe('closing');
  expect(readinessCondition({ ...healthy, listening: false })).toBe('not_listening');
  expect(readinessCondition({ ...healthy, hasRooms: false })).toBe('room_store_missing');
  expect(readinessCondition({ ...healthy, hasRooms: false, allowTestArena: true })).toBe('ready');
});
