import { createClient } from '@supabase/supabase-js';

export function browserConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const serverUrl = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (!url || !key || !serverUrl) throw new Error('Set the three variables in apps/web/.env.example, then restart Vite.');
  if (key.startsWith('sb_secret_')) throw new Error('A secret key must never be used in the browser. Use a publishable key.');
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob((key.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (payload.role !== 'anon') throw new Error('Not public');
    } catch { throw new Error('Use a public publishable key or legacy anon key.'); }
  }
  const server = new URL(serverUrl);
  if (!['ws:', 'wss:'].includes(server.protocol) || server.username || server.password || server.search || server.hash) throw new Error('Use a WebSocket URL without credentials or query parameters.');
  if (location.protocol === 'https:' && server.protocol !== 'wss:') throw new Error('An HTTPS page requires a secure wss:// server.');
  return { url, key, serverUrl };
}

export function createBrowserAuth(url: string, key: string) {
  return createClient(url, key, {
    auth: { storage: sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'neon-grid-auth-v1' },
  });
}
