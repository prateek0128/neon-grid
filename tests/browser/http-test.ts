import { test as base, expect } from '@playwright/test';
export type { Page } from '@playwright/test';
export { expect };
export const test = base.extend({
  browser: async ({ browser }, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await original(options);
      await context.addInitScript(() => {
        // A forbidden transport fails the test through pageerror; also catches Supabase Realtime.
        Object.defineProperty(window, 'WebSocket', { value: class {
          constructor() { throw new Error('HTTP-only gameplay must never create a WebSocket'); }
        } });
      });
      context.on('page', page => page.on('websocket', () => expect(false, 'Unexpected WebSocket network connection').toBe(true)));
      return context;
    };
    await use(browser);
    browser.newContext = original;
  },
});
