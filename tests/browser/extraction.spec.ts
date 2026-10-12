import { expect, test } from './http-test';
test.use({ trace: 'off' });
test('two clients share extraction, reload recovery, lockdown, replay and lobby reset', async ({ browser }) => {
  test.setTimeout(90000);
  const ca = await browser.newContext(); const cb = await browser.newContext(); const a = await ca.newPage(); const b = await cb.newPage();
  try {
    await a.goto('/'); await b.goto('/');
    await a.getByLabel('Your callsign').fill('Cipher'); await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    const code = await a.getByTestId('room-code').textContent();
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill(code!); await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(a.getByTestId('roster-member')).toHaveCount(2);
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    const self = a.locator('[data-self="true"]'); const id = await self.getAttribute('data-player-id');
    const held = new Set<string>();
    try {
      for (let i = 0; i < 120; i++) {
        const x = Number(await self.getAttribute('data-x')); const y = Number(await self.getAttribute('data-y'));
        if (Math.hypot(x - 480, y - 320) < 20) break;
        const desired = new Set<string>();
        if (Math.abs(x - 480) > 8) desired.add(x < 480 ? 'KeyD' : 'KeyA');
        if (Math.abs(y - 320) > 8) desired.add(y < 320 ? 'KeyS' : 'KeyW');
        for (const key of held) if (!desired.has(key)) { await a.keyboard.up(key); held.delete(key); }
        for (const key of desired) if (!held.has(key)) { await a.keyboard.down(key); held.add(key); }
        await a.waitForTimeout(50);
      }
    } finally { for (const key of held) await a.keyboard.up(key); }
    await expect(a.getByTestId('extraction-status')).toHaveAttribute('data-outcome', 'extracted', { timeout: 20000 });
    await expect(b.getByTestId('extraction-player').and(b.locator(`[data-member-id="${id}"]`))).toHaveText('extracted');
    const position = [await self.getAttribute('data-x'), await self.getAttribute('data-y')];
    await a.keyboard.down('KeyD'); await a.waitForTimeout(200); await a.keyboard.up('KeyD');
    expect([await self.getAttribute('data-x'), await self.getAttribute('data-y')]).toEqual(position);
    await a.reload(); await expect(a.getByTestId('extraction-status')).toHaveAttribute('data-outcome', 'extracted');
    await expect(a.getByTestId('match-results')).toBeVisible({ timeout: 10000 }); await expect(b.getByTestId('match-results')).toBeVisible();
    const outcomes = await a.getByTestId('result-player').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-player-id'), outcome: n.getAttribute('data-extraction'), score: n.getAttribute('data-score') })));
    expect(await b.getByTestId('result-player').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-player-id'), outcome: n.getAttribute('data-extraction'), score: n.getAttribute('data-score') })))).toEqual(outcomes);
    const rows = await a.getByTestId('result-player').allTextContents(); expect(await b.getByTestId('result-player').allTextContents()).not.toHaveLength(0);
    expect(rows.join(' ')).toContain('extracted'); expect(rows.join(' ')).toContain('locked down');
    await a.getByRole('button', { name: 'Play Again' }).click();
    await expect(a.getByTestId('extraction-status')).toHaveAttribute('data-phase', 'closed');
    await expect(a.getByTestId('extraction-status')).toHaveAttribute('data-outcome', 'alive');
    await expect(b.getByTestId('extraction-status')).toHaveAttribute('data-outcome', 'alive');
    await a.getByRole('button', { name: 'Return to Lobby' }).click();
    await expect(a.getByTestId('room-status')).toHaveText('LOBBY'); await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
    await expect(a.getByTestId('extraction-status')).toHaveCount(0);
  } finally { await ca.close(); await cb.close(); }
});
