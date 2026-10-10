# NEON GRID: CYBER HEIST

Phase 3A: secure private rooms, lobby, authoritative multiplayer movement, energy-core collection and combo scoring. Later heist mechanics remain out of scope.

React/TypeScript/Vite renders the interface and Canvas 2D arena. Supabase Auth supplies anonymous identity; Postgres RPCs control durable room state. A separate persistent TypeScript WebSocket server independently activates matches and owns all movement, cores and scores. No sibling game's repository, backend or credentials are used.

## Local requirements and configuration

Use Node 24.18+ in the Node 24 release line and pnpm 11.19.0. A **dedicated NEON GRID Supabase project** is required for live play; enable anonymous sign-ins and apply the migration in `supabase/migrations`. See `docs/phase2-database.md` before applying anything remotely. A project requiring CAPTCHA also needs a compatible CAPTCHA flow; that integration is not implemented here.

```sh
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
cp apps/server/.env.example apps/server/.env
```

Edit the ignored environment files; placeholders cannot connect to a project.

| File | Variable | Value/purpose |
| --- | --- | --- |
| Browser | `VITE_SUPABASE_URL` | Dedicated project URL |
| Browser | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key, or legacy public anon key |
| Browser | `VITE_GAME_SERVER_URL` | `ws://127.0.0.1:8787/ws` locally; `wss://` with HTTPS |
| Server | `SUPABASE_URL` | Same dedicated project URL |
| Server | `SUPABASE_PUBLISHABLE_KEY` | Same public key; Auth verification and user-scoped room checks |
| Server | `SUPABASE_SERVER_KEY` | Server secret key, or legacy service-role key; operational RPC only |
| Server | `HOST` | `127.0.0.1` locally |
| Server | `PORT` | `8787` locally |
| Server | `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` locally; exact origins, no trailing slashes |
| Server | `NODE_ENV` | `development` locally; `production` for later production use |
| Server | `ENABLE_MOVEMENT_TEST_ARENA` | `false` normally; `true` only with `NODE_ENV=development` for the old movement route |

**Never put the server key in a VITE variable, browser code, chat, or Git.** It is new in Phase 2 because only the trusted server may activate matches and clean rooms. The browser uses only the project URL, publishable key and WebSocket address. No migration or deployment is performed by startup.

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Server health: `http://127.0.0.1:8787/health`. Separate commands are `pnpm --filter @neon/web dev` and `pnpm --filter @neon/server dev`.

## Two-client live verification

1. Configure the dedicated project, anonymous Auth and migration above. Start both local applications.
2. Open the browser URL in a normal window and a private window or separate browser profile. These must have isolated storage; copied tabs may share the same anonymous identity.
3. In A, enter a callsign and click **Create Room**. Copy its 12-character code using **Copy code**.
4. In B, enter a different callsign, paste the code, and click **Join Room**. Both rosters should show the two distinct names; A is host and each identifies itself with `YOU`.
5. Ready both players. Only A has **Start Match**, enabled when everyone is ready and at least two members are active.
6. Start from A. Both should transition `LOBBY → STARTING → IN MATCH` and show connected movement. B cannot create a competing start; a new outsider cannot join after start.
7. Move A with WASD and B with arrows; watch each in the other window. Release stops movement; diagonals are normalized.
8. Reload B or briefly interrupt its socket. Its authorized room and membership/player ID should restore. Position resumes if the server retained it within the 15-second movement grace. Membership has a separate 30-second heartbeat window.
9. In A, choose **Return to Lobby**. This ends the active run for everyone, clears cores/scores and resets readiness. A new match begins with zero scores.
10. Leave from A. B becomes host deterministically. Leaving the final member deletes the room.
11. Restart the game server during movement. Once its old 10-second runtime lease expires, the replacement aborts the old session and returns the room to lobby with a clear error; it does not claim that gameplay continued.

For another device on the same LAN, explicitly bind Vite (`pnpm --filter @neon/web dev --host 0.0.0.0`) and server HOST to `0.0.0.0`, use the computer's LAN IP in `VITE_GAME_SERVER_URL`, and add the exact LAN browser origin to `ALLOWED_ORIGINS`. Restart Vite after changing environment. Desktop keyboard controls are included; touch controls are not.

## Checks and production builds

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

The browser build is `apps/web/dist/`; the bundled server entry is `apps/server/dist/index.js`. `pnpm start` starts that server with its ignored `.env`. Frontend preview is `pnpm --filter @neon/web preview`; its origin also needs explicit server authorization.

The database suite executes the migration, SQL functions, RLS and role grants using embedded PostgreSQL (PGlite). Auth/API fixtures are test-only. Browser tests run two isolated Chromium contexts against the built production server and Vite frontend, with those SQL-backed fixtures. These results are **not live Supabase verification**. PGlite serializes execution; its competing-final-slot test does not prove multi-connection production lock behavior. Ports 5173, 9100 and 9101 must be free. If your development browser is running, use `NEON_TEST_WEB_PORT=5174 pnpm test:browser`; fixture services remain on 9100/9101. Screenshots/traces go to ignored `test-results/`.

## Preserved development movement route

With Vite development mode and server `NODE_ENV=development`, set `ENABLE_MOVEMENT_TEST_ARENA=true`, then visit `/movement-test`. It preserves Phase 1 behavior and still requires a valid Supabase token. The route is removed from the production browser bundle; roomless socket admission is disabled outside the explicit server development setting. There is no production authentication bypass.

## Security and boundaries

Room creation/join/readiness/start/leave/return use security-definer RPCs with identity checks, fixed search paths, explicit grants, request deduplication, revision checks, row locks and database constraints. Exposed tables are member-read-only under RLS. Codes, requests, limits, matches and the server lease live in a non-exposed schema. Do not add `ng_private` to API-exposed schemas.

Authenticated lobby snapshots poll every two seconds; notifications are not a source of truth and no Supabase Realtime channel is needed. Membership snapshots and runtime state are reconciled by the server each second. Movement, cores and scores stay in match-scoped server memory and are never written per tick to Postgres. Removal is enforced at new socket admission and within the next successful server reconciliation for existing sockets. Database failure stops room movement and closes its sockets; reconnect uses fresh authorization.

Rooms expire after two hours. Cleanup runs while the persistent server is running. Dormant cleanup resumes on the next startup. Lobby membership needs a heartbeat within 30 seconds; verified live movement sockets also renew existing membership. Missing membership cannot be recreated by the heartbeat. Empty rooms are deleted. A user may hold one active room membership. Stable membership UUIDs serve as server-issued player IDs; socket session IDs change on reconnect.

One server process owns a 10-second runtime lease. This phase does not support horizontal scaling. A replacement process aborts old sessions rather than reconstructing them. Movement position memory lasts 15 seconds after socket closure; the membership identity survives as long as room membership is valid. Auth is checked at socket admission/renewal and token expiration is enforced, but immediate Auth revocation between those checks is not implemented. The client makes one forced refresh attempt after an expired session error.

No lasers, dash, shield, health, extraction, match results, round timer, additional arenas or deployment. Physical-device, non-Chromium and dedicated live-project testing remain required. See `docs/phase2-database.md`, `docs/architecture.md` and `docs/phase2-report.md`.

## Phase 3A collection rules

The existing 960×640 arena uses a 24×16 grid with 40-pixel cells and no interior walls. Eight gold cores occupy distinct valid cell centers, excluding player cells and body overlap. Move onto a core to collect it: the server checks a 22-pixel center distance after each 30 Hz movement step. Cores award 100 base points; consecutive pickups within five simulation seconds give 1×, then 2×, then 3×, capped at 3×. The multiplier and combo reset at the exact five-second deadline; points remain. Inactive cores respawn after two simulation seconds with fresh IDs and safe positions. Lower player slot wins an exact same-tick tie.

The snapshot contains cores, authoritative scores/combos and the latest 16 ordered collection events. Clients send no collection or score messages. Scores survive socket reconnection while membership and the match remain active, including after the 15-second position grace; position may reset then. Return to Lobby, match abortion or server restart clears the run. See `docs/phase3a-report.md` for verification status, security details and the live two-browser checklist.
