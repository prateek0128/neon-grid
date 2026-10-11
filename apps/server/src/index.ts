import { createSupabaseVerifier } from './auth.ts';
import { createGameServer } from './server.ts';
import { createSupabaseRooms } from './rooms.ts';
import { serverConfiguration } from './config.ts';

const config = serverConfiguration(process.env);
const server = createGameServer({ verifyToken: createSupabaseVerifier(config.url, config.key), allowedOrigins: config.origins,
  rooms: createSupabaseRooms(config.url, config.key, config.serverKey), matchDurationTicks: config.matchDurationTicks, allowTestArena: config.allowTestArena });
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); }
server.http.on('error', () => {
  console.error('NEON GRID startup failed: check HOST, PORT and whether the bind address is available.');
  process.exitCode = 1; void stop();
});
server.http.listen(config.port, config.host, () => console.log('NEON GRID server listening; check /ready before admitting players.'));
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
