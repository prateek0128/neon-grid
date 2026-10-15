import { createSupabaseVerifier } from './auth.ts';
import { createGameServer } from './legacy-websocket-server.ts';
import { createSupabaseRooms } from './rooms.ts';
import { serverConfiguration } from './config.ts';

const config = serverConfiguration(process.env);
const server = createGameServer({ verifyToken: createSupabaseVerifier(config.url, config.key), allowedOrigins: config.origins,
  rooms: createSupabaseRooms(config.url, config.key, config.serverKey), matchDurationTicks: config.matchDurationTicks, extractionWindowTicks: config.extractionWindowTicks, allowTestArena: config.allowTestArena,
  diagnostic: event => console.info('NEON GRID connection', JSON.stringify(event)) });
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); }
server.http.on('error', () => {
  console.error('NEON GRID startup failed: check HOST, PORT and whether the bind address is available.');
  process.exitCode = 1; void stop();
});
server.http.listen(config.port, config.host, () => console.log('NEON GRID server listening; check /ready before admitting players.'));
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
