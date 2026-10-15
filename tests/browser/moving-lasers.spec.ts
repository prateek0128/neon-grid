import { expect, test } from './http-test';
import { parseServerMessage } from '../../packages/protocol/src/index.ts';
import type { Snapshot } from '../../packages/protocol/src/index.ts';
test.use({ trace: 'off' });
test('moving sweeps render, share positions across two clients and recover after reload', async ({ browser }) => {
  test.skip(!process.env.NEON_TEST_MATCH_SECONDS, 'Run this test with NEON_TEST_MATCH_SECONDS=45; normal fixtures deliberately finish before escalation.');
  test.setTimeout(60000);
  const ca = await browser.newContext(); const cb = await browser.newContext(); const a = await ca.newPage(); const b = await cb.newPage();
  const first = new Map<number, Snapshot>(); const second = new Map<number, Snapshot>();
  for (const [page, snapshots] of [[a, first], [b, second]] as const) page.on('websocket', socket => {
    socket.on('framereceived', event => {
      if (typeof event.payload !== 'string') return;
      const message = parseServerMessage(event.payload);
      if (message?.type !== 'snapshot' || !message.gameplay) return;
      snapshots.set(message.gameplay.tick, message as Snapshot);
      if (snapshots.size > 240) snapshots.delete(snapshots.keys().next().value!);
    });
  });
  try {
    await a.goto('/'); await b.goto('/');
    await a.getByLabel('Your callsign').fill('Cipher'); await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(a.getByTestId('room-code')).toBeVisible();
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill((await a.getByTestId('room-code').textContent())!);
    await b.getByRole('button', { name: 'Join Room', exact: true }).click(); await expect(a.getByTestId('roster-member')).toHaveCount(2);
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-moving', 'true', { timeout: 35000 });
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-phase', 'warning');
    await expect(a.getByTestId('difficulty-stage')).toContainText('stage 2/3');
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-pattern', 'horizontal-up');
    await expect(a.getByTestId('hazard-status')).toContainText('↑ Up');
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-presentation', 'warning');
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-phase', 'active');
    const coordinate = await a.getByTestId('hazard-status').getAttribute('data-coordinate');
    await expect.poll(() => a.getByTestId('hazard-status').getAttribute('data-coordinate')).not.toBe(coordinate);
    await expect.poll(() => [...first].some(([tick, value]) => value.gameplay!.hazards?.[0]?.phase === 'active' && !!value.gameplay!.hazards[0].motion && JSON.stringify(value.gameplay!.hazards) === JSON.stringify(second.get(tick)?.gameplay?.hazards))).toBe(true);
    await b.reload(); await expect(b.getByTestId('connection-status')).toHaveText('connected');
    await expect(b.getByTestId('hazard-status')).toHaveAttribute('data-moving', 'true');
    await expect(b.getByTestId('hazard-status')).toHaveAttribute('data-stage', '2');
    await expect(b.getByTestId('hazard-status')).toHaveAttribute('data-phase', 'active', { timeout: 6000 });
    await a.screenshot({ path: 'test-results/phase5c-active.png', fullPage: true });
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-presentation', 'complete', { timeout: 6000 });
    await expect(a.getByTestId('hazard-status')).toContainText('beam off');
    await b.setViewportSize({ width: 375, height: 812 });
    await expect(b.locator('.hazard-legend')).toBeVisible();
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(b.getByTestId('hazard-status')).toHaveAttribute('data-pattern', 'vertical-left', { timeout: 6000 });
    await expect(b.getByTestId('hazard-status')).toContainText('← Left');
    await b.screenshot({ path: 'test-results/phase5c-narrow-warning.png', fullPage: true });
    await a.getByRole('button', { name: 'Return to Lobby' }).click(); await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
  } finally { await ca.close(); await cb.close(); }
});
