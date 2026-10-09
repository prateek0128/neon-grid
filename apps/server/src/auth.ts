import { createClient } from '@supabase/supabase-js';

export type VerifiedIdentity = { userId: string; expiresAt: number };
export type VerifyToken = (token: string) => Promise<VerifiedIdentity | null>;

export function createSupabaseVerifier(url: string, publishableKey: string): VerifyToken {
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) }) },
  });
  return async token => {
    // Decode expiry only after Supabase verifies the token. The decoded payload alone is never trusted.
    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      if (error.status === undefined || error.status >= 500) throw new Error('Auth unavailable');
      return null;
    }
    if (!data.user) return null;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
      if (payload.sub !== data.user.id || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) ||
          payload.exp * 1000 <= Date.now()) return null;
      return { userId: data.user.id, expiresAt: payload.exp * 1000 };
    } catch { return null; }
  };
}
