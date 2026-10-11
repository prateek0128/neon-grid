import { expect, test } from '@playwright/test';
test.use({ trace: 'off' });
test('two sessions agree on results, recover them on reload, replay once and return to lobby', async ({ browser }) => {
  test.setTimeout(90000);
  const ca = await browser.newContext(); const cb = await browser.newContext(); const a = await ca.newPage(); const b = await cb.newPage();
  let replayRequests = 0;
  a.on('websocket', socket => socket.on('framesent', frame => { const message = JSON.parse(String(frame.payload)); if (message.type === 'lifecycle' && message.action === 'replay') replayRequests++; }));
  try {
    await a.goto('/'); await b.goto('/');
    await a.getByLabel('Your callsign').fill('Cipher'); await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(a.getByTestId('room-code')).toBeVisible(); const code = (await a.getByTestId('room-code').textContent())!;
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill(code); await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(a.getByTestId('roster-member')).toHaveCount(2); await b.reload(); await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected'); await expect(b.getByTestId('connection-status')).toHaveText('connected');
    const playerIds = await a.getByTestId('player').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-player-id')));
    await expect(a.getByTestId('match-clock')).toContainText('remaining');
    await b.reload(); await expect(b.getByTestId('connection-status')).toHaveText('connected');
    const self = a.locator('[data-self="true"]');
    const id = (await self.getAttribute('data-player-id'))!;
    const ascore = a.getByTestId('score').and(a.locator(`[data-member-id="${id}"]`));
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
    await expect(a.getByTestId('match-results')).toBeVisible({ timeout: 25000 }); await expect(b.getByTestId('match-results')).toBeVisible();
    await expect(a.getByTestId('match-results')).toHaveAttribute('data-outcome', 'winner');
    const oldMatch = (await a.getByTestId('match-results').getAttribute('data-match-id'))!;
    const rows = await a.getByTestId('result-player').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-player-id'), rank: n.getAttribute('data-rank'), score: n.getAttribute('data-score'), cores: n.getAttribute('data-cores') })));
    expect(await b.getByTestId('result-player').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-player-id'), rank: n.getAttribute('data-rank'), score: n.getAttribute('data-score'), cores: n.getAttribute('data-cores') })))).toEqual(rows);
    expect(rows[0]!.id).toBe(id); expect(Number(rows[0]!.score)).toBeGreaterThan(0); expect(Number(rows[0]!.cores)).toBeGreaterThan(0);
    await expect(b.getByRole('button', { name: 'Play Again' })).toHaveCount(0); await expect(a.getByRole('button', { name: 'Play Again' })).toBeEnabled();
    await b.keyboard.press('Space'); await b.keyboard.press('KeyE'); await b.reload();
    await expect(b.getByTestId('match-results')).toHaveAttribute('data-match-id', oldMatch);
    await a.screenshot({ path: 'test-results/phase3d-results.png', fullPage: true });
    await a.getByRole('button', { name: 'Play Again' }).click();
    await expect(a.getByTestId('match-results')).toHaveCount(0); await expect(b.getByTestId('match-results')).toHaveCount(0);
    await expect(a.getByTestId('connection-status')).toHaveText('connected'); await expect(b.getByTestId('connection-status')).toHaveText('connected');
    expect(replayRequests).toBe(1); expect(await a.getByTestId('player').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-player-id')))).toEqual(playerIds);
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-cooldown', '0');
    await expect(a.locator('[data-self="true"]')).toHaveAttribute('data-health', '100'); await expect(b.locator('[data-self="true"]')).toHaveAttribute('data-health', '100');
    await expect(a.getByTestId('hazard-status')).toHaveAttribute('data-phase', 'idle');
    await expect(a.getByTestId('score').first()).toHaveAttribute('data-score', '0');
    // Finish the second run and exercise return from RESULTS through the secured room workflow.
    await expect(a.getByTestId('match-results')).toBeVisible({ timeout: 25000 });
    await expect(a.getByTestId('match-results')).not.toHaveAttribute('data-match-id', oldMatch);
    await expect(a.getByTestId('match-results')).toHaveAttribute('data-outcome', 'tie');
    await a.getByRole('button', { name: 'Return to Lobby' }).click();
    await expect(a.getByTestId('room-status')).toHaveText('LOBBY'); await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
    await expect(a.getByTestId('match-results')).toHaveCount(0); await b.reload(); await expect(b.getByTestId('room-status')).toHaveText('LOBBY');
  } finally { await ca.close(); await cb.close(); }
});
