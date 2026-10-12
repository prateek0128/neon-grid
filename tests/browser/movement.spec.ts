import { expect, test } from './http-test';
import type { Page } from './http-test';

async function position(page: Page, id: string) {
  const player = page.locator(`[data-player-id="${id}"]`);
  return { x: Number(await player.getAttribute('data-x')), y: Number(await player.getAttribute('data-y')) };
}
async function connect(page: Page) {
  await page.goto('/movement-test');
  await page.getByRole('button', { name: 'Connect player' }).click();
  await expect(page.getByTestId('connection-status')).toHaveText('connected');
  const self = page.locator('[data-self="true"]');
  await expect(self).toHaveCount(1);
  return (await self.getAttribute('data-player-id'))!;
}
test('two isolated browser sessions share movement, key release, and stable reconnect identities', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const errors: string[] = [];
  a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
  try {
    const aid = await connect(a);
    const bid = await connect(b);
    expect(aid).not.toBe(bid);
    await expect(a.getByTestId('player')).toHaveCount(2);
    await expect(b.getByTestId('player')).toHaveCount(2);
    const start = await position(a, aid);
    await a.keyboard.down('KeyD');
    await expect.poll(async () => (await position(b, aid)).x).toBeGreaterThan(start.x + 20);
    await a.keyboard.up('KeyD');
    await a.waitForTimeout(250);
    const stopped = await position(a, aid);
    await a.waitForTimeout(200);
    expect(await position(a, aid)).toEqual(stopped);
    await expect.poll(async () => (await position(b, aid)).x).toBe(stopped.x);

    const bStart = await position(b, bid);
    await b.keyboard.down('ArrowDown');
    await expect.poll(async () => (await position(a, bid)).y).toBeGreaterThan(bStart.y + 20);
    await b.keyboard.up('ArrowDown');
    await b.waitForTimeout(250);
    const bStopped = await position(b, bid);
    await b.waitForTimeout(200);
    expect(await position(b, bid)).toEqual(bStopped);

    const diagonalStart = await position(a, aid);
    await a.keyboard.down('KeyD'); await a.keyboard.down('KeyS');
    await expect.poll(async () => (await position(b, aid)).x).toBeGreaterThan(diagonalStart.x + 15);
    await a.keyboard.up('KeyD'); await a.keyboard.up('KeyS');
    await a.waitForTimeout(200);
    expect((await position(a, aid)).y).toBeGreaterThan(diagonalStart.y);

    await a.getByRole('button', { name: 'Disconnect' }).click();
    await expect(b.locator(`[data-player-id="${aid}"]`)).toHaveAttribute('data-connected', 'false');
    await expect(b.locator('[data-self="true"]')).toHaveAttribute('data-player-id', bid);
    await a.getByRole('button', { name: 'Connect player' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.locator('[data-self="true"]')).toHaveAttribute('data-player-id', aid);
    await expect(b.locator(`[data-player-id="${aid}"]`)).toHaveAttribute('data-connected', 'true');

    await a.reload();
    await a.getByRole('button', { name: 'Connect player' }).click();
    await expect(a.getByTestId('connection-status')).toHaveText('connected');
    await expect(a.locator('[data-self="true"]')).toHaveAttribute('data-player-id', aid);
    expect(errors).toEqual([]);
    await a.screenshot({ path: 'test-results/movement-proof.png', fullPage: true });
  } finally { await contextA.close(); await contextB.close(); }
});

test('blur clears held keys and HTTP polling recovers from a network interruption', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const id = await connect(page);
    const start = await position(page, id);
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await position(page, id)).x).toBeGreaterThan(start.x + 15);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(250);
    const stopped = await position(page, id);
    await page.waitForTimeout(200);
    expect(await position(page, id)).toEqual(stopped);
    await page.keyboard.up('ArrowRight');
    await context.setOffline(true);
    await expect(page.getByTestId('connection-status')).toHaveText('reconnecting');
    await context.setOffline(false);
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 10000 });
    await expect(page.locator('[data-self="true"]')).toHaveAttribute('data-player-id', id);
  } finally { await context.close(); }
});
