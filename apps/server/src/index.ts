import { createSupabaseVerifier } from './auth.ts';
import { createGameServer } from './server.ts';
import { createSupabaseRooms } from './rooms.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const origins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? '8787');
if (!url || !key || !origins?.length || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGINS and a valid PORT. See apps/server/.env.example.');
}
if (key.startsWith('sb_secret_')) throw new Error('Use a publishable key, never a secret key.');
if (key.startsWith('eyJ')) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()) as { role?: string };
    if (payload.role !== 'anon') throw new Error('Only a public anon or publishable key is allowed.');
  } catch { throw new Error('Invalid public key configuration.'); }
}
for (const origin of origins) {
  if (new URL(origin).origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact origins without paths.');
}
const serverKey = process.env.SUPABASE_SERVER_KEY;
const allowTestArena = process.env.ENABLE_MOVEMENT_TEST_ARENA === 'true' && process.env.NODE_ENV === 'development';
if (!serverKey) throw new Error('Configure SUPABASE_SERVER_KEY on the server only for secure room operations.');
if (!serverKey.startsWith('sb_secret_')) {
  try {
    const payload = JSON.parse(Buffer.from(serverKey.split('.')[1] ?? '', 'base64url').toString()) as { role?: string };
    if (payload.role !== 'service_role') throw new Error('Wrong role');
  } catch { throw new Error('SUPABASE_SERVER_KEY must be a server secret or legacy service-role key.'); }
}
const server = createGameServer({ verifyToken: createSupabaseVerifier(url, key), allowedOrigins: origins,
  rooms: createSupabaseRooms(url, key, serverKey), allowTestArena });
server.http.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`NEON GRID movement server listening on port ${port}`));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); }
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
