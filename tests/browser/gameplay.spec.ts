import { expect, test } from './http-test';

// The local Playwright artifact transport truncates this two-context trace on close.
// Assertions and the collection screenshot still run; other regressions retain traces.
test.use({ trace: 'off' });

test('two isolated sessions see core collection, equal scores, reconnect state and a clean new match', async ({ browser }) => {
  test.setTimeout(60000);
  const ca = await browser.newContext(); const cb = await browser.newContext();
  const a = await ca.newPage(); const b = await cb.newPage();
  try {
    await a.goto('/'); await b.goto('/');
    await a.getByLabel('Your callsign').fill('Cipher');
    await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(a.getByTestId('room-code')).toBeVisible();
    const code = (await a.getByTestId('room-code').textContent())!;
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill(code);
    await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(a.getByTestId('roster-member')).toHaveCount(2);
    await a.getByRole('button', { name: 'Ready up' }).click();
    await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled();
    await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(b.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.getByTestId('core')).toHaveCount(8);
    const self = a.locator('[data-self="true"]');
    const id = (await self.getAttribute('data-player-id'))!;
    const ascore = a.getByTestId('score').and(a.locator(`[data-member-id="${id}"]`));
    const bscore = b.getByTestId('score').and(b.locator(`[data-member-id="${id}"]`));
    const start = { x: Number(await self.getAttribute('data-x')), y: Number(await self.getAttribute('data-y')) };
    const targets = await a.getByTestId('core').evaluateAll(elements => elements.map(e => ({ x: Number(e.getAttribute('data-x')), y: Number(e.getAttribute('data-y')) })));
    const target = targets.sort((p, q) => Math.hypot(p.x - start.x, p.y - start.y) - Math.hypot(q.x - start.x, q.y - start.y))[0]!;
    const held = new Set<string>();
    const deadline = Date.now() + 10000;
    try {
      while (Date.now() < deadline && Number(await ascore.getAttribute('data-score')) === 0) {
        const x = Number(await self.getAttribute('data-x')); const y = Number(await self.getAttribute('data-y'));
        const desired = new Set<string>();
        if (Math.abs(target.x - x) > 8) desired.add(target.x > x ? 'KeyD' : 'KeyA');
        if (Math.abs(target.y - y) > 8) desired.add(target.y > y ? 'KeyS' : 'KeyW');
        for (const key of held) if (!desired.has(key)) { await a.keyboard.up(key); held.delete(key); }
        for (const key of desired) if (!held.has(key)) { await a.keyboard.down(key); held.add(key); }
        await a.waitForTimeout(50);
      }
    } finally { for (const key of held) await a.keyboard.up(key); }
    await expect.poll(async () => Number(await ascore.getAttribute('data-score'))).toBeGreaterThan(0);
    const points = (await ascore.getAttribute('data-score'))!;
    await expect(bscore).toHaveAttribute('data-score', points);
    await expect(a.getByTestId('collection-event')).toContainText('collected a core');
    await a.screenshot({ path: 'test-results/phase3a-core-run.png', fullPage: true });
    await a.reload(); await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.getByTestId('score').and(a.locator(`[data-member-id="${id}"]`))).toHaveAttribute('data-score', points);
    await expect(a.locator('[data-self="true"]')).toHaveAttribute('data-player-id', id);
    await a.getByRole('button', { name: 'Return to Lobby' }).click();
    await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
    await expect(a.getByTestId('score')).toHaveCount(0); await expect(a.getByTestId('core')).toHaveCount(0);
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.getByTestId('score').and(a.locator(`[data-member-id="${id}"]`))).toHaveAttribute('data-score', '0');
    await expect(a.getByTestId('core')).toHaveCount(8);
  } finally { await ca.close(); await cb.close(); }
});
