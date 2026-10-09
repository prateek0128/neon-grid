import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

// Test-only Auth service. Tokens are deliberately unsigned fixtures, accepted only by this service.
// Production index.ts has no fixture mode and always uses the configured Supabase Auth endpoint.
export function createAuthFixture() {
  const identities = new Map<string, { id: string; exp: number }>();
  function issue(id = randomUUID(), lifetimeSeconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    const token = `${Buffer.from(JSON.stringify({ alg: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp, aud: 'authenticated', role: 'authenticated' })).toString('base64url')}.fixture`;
    identities.set(token, { id, exp });
    return token;
  }
  function user(id: string) {
    return { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  }
  const http = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/auth/v1/signup' && request.method === 'POST') {
      const access_token = issue();
      const identity = identities.get(access_token)!;
      response.end(JSON.stringify({ access_token, token_type: 'bearer', expires_in: 3600, expires_at: identity.exp, refresh_token: randomUUID(), user: user(identity.id) }));
      return;
    }
    if (request.url === '/auth/v1/user' && request.method === 'GET') {
      const identity = identities.get(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
      if (identity && identity.exp * 1000 > Date.now()) { response.end(JSON.stringify(user(identity.id))); return; }
      response.writeHead(401); response.end(JSON.stringify({ msg: 'Invalid token', code: 'bad_jwt' })); return;
    }
    response.writeHead(404); response.end(JSON.stringify({ error: 'Fixture endpoint not found' }));
  });
  return { http, issue };
}
