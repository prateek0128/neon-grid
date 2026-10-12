// Historical validation used exclusively by the original transport tests.
export type PublicEnvironment = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string; VITE_GAME_SERVER_URL?: string };
export const loopbackHost = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
function configuredUrl(value: string, name: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || value !== value.trim()) throw new Error();
    return url;
  } catch { throw new Error(`${name} must be a URL without credentials, query parameters or fragments.`); }
}
export function validatePublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob((key.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (payload.role === 'anon' && key.split('.').length === 3) return;
    } catch { /* Report variable name only, never the credential. */ }
  }
  throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable key or legacy anon key. Never use a server secret.');
}
export function validateBrowserEnvironment(env: PublicEnvironment, options: { production: boolean; allowLocal?: boolean; pageProtocol?: string }) {
  const url = env.VITE_SUPABASE_URL; const key = env.VITE_SUPABASE_PUBLISHABLE_KEY; const serverUrl = env.VITE_GAME_SERVER_URL;
  if (!url || !key || !serverUrl) throw new Error('Configure VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_GAME_SERVER_URL, then rebuild or restart Vite.');
  validatePublicKey(key);
  const supabase = configuredUrl(url, 'VITE_SUPABASE_URL'); const server = configuredUrl(serverUrl, 'VITE_GAME_SERVER_URL');
  if (supabase.pathname !== '/' || (supabase.protocol !== 'https:' && !(supabase.protocol === 'http:' && loopbackHost(supabase.hostname) && (!options.production || options.allowLocal)))) throw new Error('VITE_SUPABASE_URL requires an HTTPS base URL; HTTP loopback is for local testing only.');
  if (!['ws:', 'wss:'].includes(server.protocol) || server.pathname !== '/ws') throw new Error('VITE_GAME_SERVER_URL must use ws:// or wss:// with the /ws path.');
  if (options.pageProtocol === 'https:' && server.protocol !== 'wss:') throw new Error('An HTTPS page requires a secure wss:// game server.');
  const localServer = loopbackHost(server.hostname);
  if (options.production && ((server.protocol !== 'wss:' && !(options.allowLocal && localServer)) || (localServer && !options.allowLocal))) throw new Error('Production requires a public wss:// game server. Use pnpm build:local only for local validation.');
  return { url, key, serverUrl };
}
export function rejectBrowserSecrets(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) if (value && name.startsWith('VITE_') && (/SECRET|SERVICE_ROLE|SERVER_KEY|PRIVATE_KEY/i.test(name) || value.startsWith('sb_secret_') || /-----BEGIN .*PRIVATE KEY-----/.test(value))) {
    throw new Error('Remove server-only credentials from VITE_ variables before building.');
  }
  for (const [name, value] of Object.entries(env)) if (name.startsWith('VITE_') && value?.startsWith('eyJ')) validatePublicKey(value);
}
