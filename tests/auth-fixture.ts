import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { createTestDatabase } from './database.ts';

// Test-only Auth service. Tokens are deliberately unsigned fixtures, accepted only by this service.
// Production index.ts has no fixture mode and always uses the configured Supabase Auth endpoint.
export function createAuthFixture(database?: Awaited<ReturnType<typeof createTestDatabase>>) {
  const identities = new Map<string, { id: string; exp: number }>();
  function issue(id: string = randomUUID(), lifetimeSeconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    const token = `${Buffer.from(JSON.stringify({ alg: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp, aud: 'authenticated', role: 'authenticated' })).toString('base64url')}.fixture`;
    identities.set(token, { id, exp });
    return token;
  }
  function user(id: string) {
    return { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  }
  const http = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, content-profile, accept-profile, x-client-info, x-supabase-api-version');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.url === '/auth/v1/signup' && request.method === 'POST') {
      const access_token = issue();
      const identity = identities.get(access_token)!;
      if (database) await database.db.query('insert into auth.users values($1) on conflict do nothing', [identity.id]);
      response.end(JSON.stringify({ access_token, token_type: 'bearer', expires_in: 3600, expires_at: identity.exp, refresh_token: randomUUID(), user: user(identity.id) }));
      return;
    }
    if (request.url === '/auth/v1/user' && request.method === 'GET') {
      const identity = identities.get(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
      if (identity && identity.exp * 1000 > Date.now()) { response.end(JSON.stringify(user(identity.id))); return; }
      response.writeHead(401); response.end(JSON.stringify({ msg: 'Invalid token', code: 'bad_jwt' })); return;
    }
    if (database && request.url?.startsWith('/rest/v1/rpc/') && request.method === 'POST') {
      const identity = identities.get(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
      const operational = request.headers.apikey === 'sb_secret_test_fixture';
      if (!operational && (!identity || identity.exp * 1000 <= Date.now())) {
        response.writeHead(401); response.end(JSON.stringify({ message: 'Invalid token', code: 'bad_jwt' })); return;
      }
      try {
        let body = ''; for await (const chunk of request) body += chunk.toString();
        const result = await database.rpc(operational ? null : identity!.id, request.url.slice('/rest/v1/rpc/'.length), JSON.parse(body), operational ? 'service_role' : 'authenticated');
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(403); response.end(JSON.stringify({ message: error instanceof Error ? error.message : 'SQL fixture error', code: '42501' }));
      }
      return;
    }
    response.writeHead(404); response.end(JSON.stringify({ error: 'Fixture endpoint not found' }));
  });
  return { http, issue };
}
