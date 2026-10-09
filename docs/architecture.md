# Phase 1 architecture

## Separation

`apps/web` owns React screens, session creation, keyboard listeners, connection retries and Canvas rendering. `apps/server` owns trusted identity validation, socket sessions, player allocation and authoritative movement. `packages/protocol` defines and validates wire messages. `packages/simulation` defines arena dimensions, spawn locations, vector normalization and movement.

The simulation is deliberately small: one 960 × 640 arena, four slots, radius 14, speed 210 units/second. There are no walls inside the arena and players may overlap. All four boundaries clamp the full player radius.

## Protocol version 1

1. The browser opens `/ws` with an allowed Origin.
2. It sends `{type: "authenticate", version: 1, accessToken}` in a message, never in a URL.
3. The server calls Supabase Auth `getUser(accessToken)`. A decoded JWT is never sufficient evidence of identity. After remote verification, the server checks the matching subject and expiration.
4. The server replies with `welcome`: a random player ID, random socket session ID, server epoch and tick rate. Auth user IDs and tokens are not broadcast.
5. Movement messages contain only `type`, `version`, `sessionId`, integer increasing `sequence`, and `movement: {x,y}`.
6. The server broadcasts snapshots with epoch, tick and public player states. `lastSequence` means the latest accepted input, not a client timestamp.
7. Token refresh uses another `authenticate` message on the same socket. It must verify as the original Auth identity; it cannot switch players.

There is one active socket per Auth user. A second active connection gets `SESSION_IN_USE`; it cannot take over the original socket. Every reconnect gets a fresh socket session ID and sequence space. Disconnected players retain position/player ID for 15 seconds while movement is neutral; after expiry the slot and identity are discarded.

## Timing

A monotonic clock feeds a 30 Hz fixed-step accumulator. Movement uses constant `1/30` second steps. Catch-up is capped at five steps per scheduling interval to prevent movement jumps after process stalls. Snapshots are sent every two ticks (15 Hz). The browser sends current intent at 30 Hz and on key changes.

Movement vectors have finite components within [-1,1]. Lengths above one are normalized by the server. Clients cannot specify delta time, position, player ID, speed or arena dimensions. Unchanged movement is repeated; after 250 ms without input, the server neutralizes it. Blur/hidden-page handling sends neutral intent, with server timeout as a fallback.

Rendering runs separately using animation frames and eases each visible position toward the latest authoritative snapshot. The roster displays exact server positions. Out-of-order snapshots within an epoch are ignored; a new epoch clears visual position history.

## Security and cleanup

- Exact allowed origins, exact `/ws` path, no token in query string.
- Five-second authentication deadline, 32 pending/active socket ceiling, four-player cap.
- 8 KiB transport payload cap; 4 KiB token bound; reject binary input and extra fields.
- Per-connection token bucket: 60 messages/second, burst 90, counting authentication and malformed attempts.
- Strictly increasing safe-integer sequence numbers and socket-bound session IDs.
- Reject/close malformed input, invalid sessions, replay, abuse and identity replacement.
- Four-second Auth fetch timeout; failures are explicit and do not grant a player.
- Token expiration checked during play; refreshed tokens must retain identity.
- Ping/pong liveness checks and slow-consumer buffer cutoff.
- Close immediately neutralizes the player; delayed close cannot detach a different socket.
- Shutdown clears simulation and heartbeat timers and terminates sockets.
- Browser disconnect/unmount removes keyboard listeners, Auth subscription, input interval, reconnect timer, connect deadline and socket handlers.
- Canvas unmount cancels its animation frame.
- No database mutation, privileged key, raw input/token logging, Auth fixture mode or shared-game dependency in production code.

Tests cover vectors/bounds, keyboard mapping, strict envelopes, authenticated multi-client snapshots, key release, expired/unknown sessions, malformed messages, spoofed socket IDs, replay, rates, stale-input timeout, reconnect identity, duplicates, capacity, renewal and origin denial. Playwright tests exercise real browser behavior using the test-only Auth fixture.
