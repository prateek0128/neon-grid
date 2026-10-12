import { expect, test } from './http-test';
test.use({ trace: 'off' });
test('stores cosmetic choices locally while the authoritative arena starts normally', async ({ browser }) => {
  test.setTimeout(40000);
  const host = await browser.newContext(), peer = await browser.newContext();
  const a = await host.newPage(), b = await peer.newPage();
  try {
    await a.goto('/'); await b.goto('/');
    await a.getByLabel('Player color').selectOption('#ff7eb6'); await a.getByLabel('Trail style').selectOption('spark');
    await a.getByLabel('Your callsign').fill('Cipher'); await a.getByRole('button', { name: 'Create Room', exact: true }).click();
    await b.getByLabel('Your callsign').fill('Ghost'); await b.getByLabel('Room code', { exact: true }).fill((await a.getByTestId('room-code').textContent())!); await b.getByRole('button', { name: 'Join Room', exact: true }).click();
    await a.getByRole('button', { name: 'Ready up' }).click(); await b.getByRole('button', { name: 'Ready up' }).click(); await a.getByRole('button', { name: 'Start Match' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.locator('canvas')).toBeVisible();
    await a.reload(); await expect(a.getByTestId('room-code')).toBeVisible();
    expect(await a.evaluate(() => JSON.parse(localStorage.getItem('neon-grid-cosmetics-v1') ?? '{}').color)).toBe('#ff7eb6');
  } finally { await host.close(); await peer.close(); }
});
