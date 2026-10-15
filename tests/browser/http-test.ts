import { test as base, expect } from '@playwright/test';
export type { Page } from '@playwright/test';
export { expect };
// Gameplay uses the authenticated WSS authority. Supabase Realtime is deliberately
// not opened by the game: Broadcast does not make browser inputs authoritative.
export const test = base;
