import { validateBrowserEnvironment } from '@neon/protocol';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export class AuthenticationError extends Error {}

export async function browserSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getSession();
  if (error) throw new AuthenticationError('Session recovery failed. Please try Create Room or Join Room again.');
  const session = data.session;
  if (session && (!session.access_token || !session.user?.id)) {
    throw new AuthenticationError('Authentication returned an incomplete session. Please try again.');
  }
  return session;
}

export async function ensureBrowserIdentity(client: SupabaseClient) {
  if (await browserSession(client)) return;
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new AuthenticationError(`Anonymous sign-in failed: ${error.message}`);
  if (!data.session?.access_token || !data.session.user?.id || !await browserSession(client)) {
    throw new AuthenticationError('Anonymous sign-in did not establish a session. Please try again.');
  }
}

export function browserConfiguration() {
  return validateBrowserEnvironment(import.meta.env, { production: import.meta.env.PROD,
    allowLocal: ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && location.protocol === 'http:', pageProtocol: location.protocol });
}

export function createBrowserAuth(url: string, key: string) {
  return createClient(url, key, {
    auth: { storage: sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'neon-grid-auth-v1' },
  });
}
