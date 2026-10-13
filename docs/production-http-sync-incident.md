# Production HTTP match synchronization incident — 13 October 2026

## Confirmed cause

The public Vercel document references `/assets/index-yJPBLO7x.js`. Its built public configuration contains `wss://neon-grid-server-uske.onrender.com/ws`, proving that Vercel is serving a pre-HTTP-migration browser build. That client attempts a WebSocket connection and cannot call the current HTTP gameplay endpoints.

The public Render service is separately not ready: `GET /health` returned HTTP 200 with `{\"status\":\"ok\",\"protocol\":1}`, while `GET /ready` returned HTTP 503. A token-free `POST /game/connect` sent with the production Vercel Origin returned HTTP 503 with `{\"error\":\"AUTHORITY_UNAVAILABLE\"}`. Its CORS preflight returned HTTP 204 and allowed the production Origin, Authorization, Content-Type and X-Game-Session headers. This rules out the observed failure being caused by the current HTTP route being absent or its production CORS policy rejecting the frontend.

The 503 occurs before credentials are examined in `apps/server/src/server.ts`: readiness is checked at line 95 before the Authorization header at line 96. It is consistent with the existing database-fenced authority/lease condition, but this investigation did not inspect production logs or ownership and therefore does not identify the lease holder.

## Local changes

- `apps/web/src/connection.ts` now changes sustained HTTP 503 authority failures from the transient `reconnecting` status to a visible recoverable `error` after four failed attempts. It preserves room/session metadata and keeps bounded automatic recovery active; a valid authoritative snapshot returns it to `connected`.
- `apps/web/src/http-connection.test.ts` covers sustained 503 status and automatic recovery.
- `docs/deployment.md` now documents the HTTP-only production URL (`https://…/`) and `/game/*` validation flow, replacing stale WebSocket deployment instructions.

No server authority, lease, authentication, RLS, Supabase setting, environment file, deployment configuration or gameplay rule changed.

## Validation

- Focused HTTP client/configuration/production-build tests: 17 passed across 3 files.
- Complete automated suite: all 298 tests across 34 files passed. The execution environment limits individual command output windows, so the embedded-Postgres room suite was run as two named groups (8 + 7 tests), the remaining web/protocol/simulation/build group passed 167 tests, and server groups passed 86, 19 and 11 tests. The groups collectively cover every test file exactly once.
- `pnpm typecheck`: passed.
- `VITE_GAME_SERVER_URL=https://neon-grid-server-uske.onrender.com/ pnpm build`: passed for web and server.
- `pnpm build:local`: passed for web and server.
- HTTP-only browser fixtures: room create/join/start/recovery passed (1 scenario); independent two-client movement, key release and network-interruption recovery passed (2 scenarios). The longer final lifecycle browser scenario was started but did not complete within this execution environment's 60-second command window, so it is not reported as a pass.
- `git diff --check`: passed.

These are local fixture/build checks. They do not authenticate against production Supabase or demonstrate live production recovery.

## Required production recovery

1. Identify the active owner of the production singleton lease from Render/Supabase operational logs without logging credentials or tokens. Do not delete or overwrite the lease. If an unintended owner is confirmed, stop it in a controlled maintenance window and allow natural expiry/reconciliation.
2. Require repeated `GET https://neon-grid-server-uske.onrender.com/ready` responses of HTTP 200 before testing a game.
3. Update Vercel Production `VITE_GAME_SERVER_URL` to `https://neon-grid-server-uske.onrender.com/`, then deploy the current HTTP-only frontend revision. Deploy the matching current Render server revision if it is not already deployed. These are production actions and were not performed here.
4. In the deployed browser Network panel, confirm `POST /game/connect` succeeds, then `POST /game/step` returns authoritative snapshots. Confirm there is no gameplay WebSocket or Supabase Realtime connection.
5. Using two isolated browser sessions, create/join a fresh room, ready/start, verify matching player IDs/snapshots and movement, reload one session, then verify reconnect recovery, extraction/results, replay and lobby return.

Production recovery is not claimed. The deployed client/server revisions and readiness must both be corrected before authenticated multiplayer can be accepted.
