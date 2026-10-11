import { isIP } from 'node:net';
import { validatePublicKey, loopbackHost } from '@neon/protocol';
import { MATCH_RULES, TICK_RATE } from '@neon/protocol';
export function validateOrigins(origins: string[]) {
  if (!origins.length || origins.some(origin => {
    try { const url = new URL(origin); return origin.includes('*') || !['https:', 'http:'].includes(url.protocol) || url.origin !== origin || !!url.username || !!url.password; }
    catch { return true; }
  })) throw new Error('ALLOWED_ORIGINS must list exact HTTP(S) origins without paths, wildcards or credentials.');
}
export function serverConfiguration(env: Record<string, string | undefined>) {
  const production = env.NODE_ENV === 'production';
  if (!['development', 'production'].includes(env.NODE_ENV ?? '')) throw new Error('Configure NODE_ENV as development or production.');
  const url = env.SUPABASE_URL; const key = env.SUPABASE_PUBLISHABLE_KEY; const serverKey = env.SUPABASE_SERVER_KEY;
  if (!url || !key || !serverKey) throw new Error('Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and server-only SUPABASE_SERVER_KEY.');
  validatePublicKey(key);
  let supabase: URL;
  try { supabase = new URL(url); } catch { throw new Error('SUPABASE_URL must be an HTTPS base URL.'); }
  if (url !== url.trim() || supabase.username || supabase.password || supabase.search || supabase.hash || supabase.pathname !== '/' ||
      (supabase.protocol !== 'https:' && !(supabase.protocol === 'http:' && !production && loopbackHost(supabase.hostname)))) throw new Error('SUPABASE_URL must be an HTTPS base URL; HTTP loopback is development-only.');
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(serverKey)) {
    try {
      const payload = JSON.parse(Buffer.from(serverKey.split('.')[1] ?? '', 'base64url').toString()) as { role?: string };
      if (serverKey.split('.').length !== 3 || payload.role !== 'service_role') throw new Error();
    } catch { throw new Error('SUPABASE_SERVER_KEY must be a server secret or legacy service-role key.'); }
  }
  const origins = env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) ?? [];
  validateOrigins(origins);
  if (production && origins.some(origin => new URL(origin).protocol !== 'https:' || loopbackHost(new URL(origin).hostname))) throw new Error('Production ALLOWED_ORIGINS requires exact public HTTPS origins.');
  const host = env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
  if (!isIP(host)) throw new Error('HOST must be a valid bind IP address.');
  const port = Number(env.PORT ?? (production ? '10000' : '8787'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const seconds = Number(env.MATCH_DURATION_SECONDS ?? String(MATCH_RULES.durationTicks / TICK_RATE));
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error('MATCH_DURATION_SECONDS must be an integer from 10 to 3600.');
  if (env.ENABLE_MOVEMENT_TEST_ARENA !== undefined && !['true', 'false'].includes(env.ENABLE_MOVEMENT_TEST_ARENA)) throw new Error('ENABLE_MOVEMENT_TEST_ARENA must be true or false.');
  if (production && env.ENABLE_MOVEMENT_TEST_ARENA === 'true') throw new Error('Disable ENABLE_MOVEMENT_TEST_ARENA in production.');
  return { url, key, serverKey, origins, host, port, matchDurationTicks: seconds * TICK_RATE,
    allowTestArena: !production && env.ENABLE_MOVEMENT_TEST_ARENA === 'true' };
}
