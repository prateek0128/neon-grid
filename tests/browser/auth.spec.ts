import { expect, test } from '@playwright/test';

test('fresh landing sends no room RPC before anonymous sign-in', async ({ page }) => {
  let calls = 0;
  let signedIn = false;
  const authenticatedRequests: boolean[] = [];
  page.on('response', response => { if (response.url().includes('/auth/v1/signup') && response.ok()) signedIn = true; });
  page.on('request', request => {
    if (request.url().includes('/rest/v1/rpc/')) {
      calls++;
      const headers = request.headers();
      authenticatedRequests.push(signedIn && headers.apikey === 'sb_publishable_test_fixture' &&
        !!headers.authorization?.startsWith('Bearer ') && headers.authorization !== `Bearer ${headers.apikey}`);
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeVisible();
  await page.waitForTimeout(4500);
  expect(calls).toBe(0);
  await page.getByLabel('Your callsign').fill('AuthProbe');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  expect(authenticatedRequests.length).toBeGreaterThan(0);
  expect(authenticatedRequests.every(Boolean)).toBe(true);
});

test('failed signup is visible and never invokes room RPCs', async ({ page }) => {
  let calls = 0;
  page.on('request', request => { if (request.url().includes('/rest/v1/rpc/')) calls++; });
  await page.route('**/auth/v1/signup', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ msg: 'Anonymous signup unavailable' }) }));
  await page.goto('/');
  await page.getByLabel('Your callsign').fill('AuthProbe');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Anonymous sign-in failed');
  await page.waitForTimeout(4500);
  expect(calls).toBe(0);
});

test('permission denial stops background polling and appears visibly', async ({ page }) => {
  let calls = 0;
  await page.route('**/rest/v1/rpc/ng_get_room', route => {
    calls++;
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'permission denied for function ng_get_room' }) });
  });
  await page.goto('/');
  await page.getByLabel('Your callsign').fill('AuthProbe');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Room access was denied');
  await page.waitForTimeout(4500);
  expect(calls).toBe(1);
});
