import { expect, test } from './http-test';

// Match the gameplay regression's workaround for local two-context trace transport.
test.use({ trace: 'off' });

test('two sessions synchronize Dash/Shield, keep cooldowns through reload and clear abilities on return', async ({ browser }) => {
  test.setTimeout(60000);
  const ca = await browser.newContext(); const cb = await browser.newContext();
  const a = await ca.newPage(); const b = await cb.newPage();
  try {
    await a.goto('/'); await b.goto('/');
    await expect(a.getByTestId('ability-hud')).toHaveCount(0);
    await a.getByLabel('Your callsign').fill('Cipher'); await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(a.getByTestId('room-code')).toBeVisible(); const code = (await a.getByTestId('room-code').textContent())!;
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill(code);
    await b.getByRole('button', { name: 'Join Room', exact: true }).click(); await expect(a.getByTestId('roster-member')).toHaveCount(2);
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected'); await expect(b.getByTestId('connection-status')).toHaveText('connected');
    const id = (await a.locator('[data-self="true"]').getAttribute('data-player-id'))!;
    const remote = b.locator(`[data-player-id="${id}"]`);
    await a.getByRole('button', { name: /^Dash/ }).click();
    await expect(a.getByTestId('ability-hud')).toContainText('Move first');
    await a.keyboard.down('KeyE'); await a.keyboard.down('KeyE'); await a.keyboard.up('KeyE');
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-active', 'true');
    await expect(remote).toHaveAttribute('data-shield-active', 'true');
    await a.reload(); await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-active', 'true');
    await expect(a.getByRole('button', { name: /^Shield/ })).toBeDisabled();
    await a.screenshot({ path: 'test-results/phase3b-shield.png', fullPage: true });
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-active', 'false');
    await expect(remote).toHaveAttribute('data-shield-active', 'false');
    const start = Number(await remote.getAttribute('data-x'));
    await a.keyboard.down('KeyD'); await a.keyboard.press('Space');
    await expect(a.getByRole('button', { name: /^Dash/ })).toBeDisabled();
    await expect.poll(async () => Number(await remote.getAttribute('data-x'))).toBeGreaterThan(start + 60);
    await a.keyboard.up('KeyD');
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await a.getByRole('button', { name: 'Return to Lobby' }).click();
    await expect(b.getByTestId('room-status')).toHaveText('LOBBY'); await expect(a.getByTestId('ability-hud')).toHaveCount(0);
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click();
    await expect(a.getByRole('button', { name: 'Start Match' })).toBeEnabled(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-dash-cooldown', '0');
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-cooldown', '0');
    await expect(a.getByTestId('ability-hud')).toHaveAttribute('data-shield-active', 'false');
  } finally { await ca.close(); await cb.close(); }
});
