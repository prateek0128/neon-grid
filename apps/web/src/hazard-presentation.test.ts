import { expect, it } from 'vitest';
import { laserAtTick } from '@neon/simulation';
import { hazardPresentation } from './hazard-presentation.ts';
it('distinguishes pending, warning, damaging activation and completed states using snapshot ticks', () => {
  expect(hazardPresentation(laserAtTick(0), 0).phase).toBe('pending');
  const warning = laserAtTick(900);
  expect(hazardPresentation(warning, 900)).toMatchObject({ phase: 'warning', name: 'Horizontal sweep · ↑ Up' });
  expect(hazardPresentation(warning, 900).detail).toContain('1.5s');
  expect(hazardPresentation(laserAtTick(945), 945).detail).toContain('ACTIVE');
  expect(hazardPresentation(laserAtTick(1005), 1005)).toMatchObject({ phase: 'complete' });
  expect(hazardPresentation(laserAtTick(1005), 1005).detail).toContain('beam off');
  expect(hazardPresentation(undefined, 900).phase).toBe('pending');
});
it('supports static and legacy moving snapshots without choosing a gameplay pattern', () => {
  expect(hazardPresentation(laserAtTick(180), 180).detail).toContain('avoid the dashed line');
  const legacy = laserAtTick(945); delete legacy.pattern;
  expect(hazardPresentation(legacy, 945).name).toBe('Moving sweep');
  expect(legacy.pattern).toBeUndefined();
});
