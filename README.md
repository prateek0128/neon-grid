# NEON GRID: CYBER HEIST

HTTP-only gameplay migration: authenticated actions and adaptive snapshot polling for the complete match loop. Public deployment and live production verification remain pending; see `docs/phase4-report.md` and `docs/deployment.md`.

React/TypeScript/Vite renders the interface and Canvas 2D arena. Supabase Auth supplies anonymous identity; Postgres RPCs control durable room state. A separate persistent TypeScript HTTP server independently activates matches and owns all movement, cores, scores and abilities. No sibling game's repository, backend or credentials are used.

Gameplay uses no WebSocket or Supabase Realtime connection. See [HTTP migration report](docs/http-only-migration-report.md) for endpoints, limits, recovery and validation. Historical transport tests are retained separately.

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
| Browser | `VITE_GAME_SERVER_URL` | `http://127.0.0.1:8787/` locally; `https://` in production |
| Server | `SUPABASE_URL` | Same dedicated project URL |
| Server | `SUPABASE_PUBLISHABLE_KEY` | Same public key; Auth verification and user-scoped room checks |
| Server | `SUPABASE_SERVER_KEY` | Server secret key, or legacy service-role key; operational RPC only |
| Server | `HOST` | `127.0.0.1` locally |
| Server | `PORT` | `8787` locally |
| Server | `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` locally; exact origins, no trailing slashes |
| Server | `NODE_ENV` | `development` locally; `production` for later production use |
| Server | `ENABLE_MOVEMENT_TEST_ARENA` | `false` normally; `true` only with `NODE_ENV=development` for the old movement route |

**Never put the server key in a VITE variable, browser code, chat, or Git.** It is new in Phase 2 because only the trusted server may activate matches and clean rooms. The browser uses only the project URL, publishable key and HTTP base URL. No migration or deployment is performed by startup.

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Server liveness: `http://127.0.0.1:8787/health`; readiness: `http://127.0.0.1:8787/ready`. Readiness must return 200 before game connections are admitted. Separate commands are `pnpm --filter @neon/web dev` and `pnpm --filter @neon/server dev`.

## Two-client live verification

1. Configure the dedicated project, anonymous Auth and migration above. Start both local applications.
2. Open the browser URL in a normal window and a private window or separate browser profile. These must have isolated storage; copied tabs may share the same anonymous identity.
3. In A, enter a callsign and click **Create Room**. Copy its 12-character code using **Copy code**.
4. In B, enter a different callsign, paste the code, and click **Join Room**. Both rosters should show the two distinct names; A is host and each identifies itself with `YOU`.
5. Ready both players. Only A has **Start Match**, enabled when everyone is ready and at least two members are active.
6. Start from A. Both should transition `LOBBY → STARTING → IN MATCH` and show connected movement. B cannot create a competing start; a new outsider cannot join after start.
7. Move A with WASD and B with arrows; watch each in the other window. Release stops movement; diagonals are normalized.
8. Reload B or briefly interrupt its HTTP connection. Its authorized room and membership/player ID should restore. Position resumes if the server retained it within the 15-second movement grace. Membership has a separate 30-second heartbeat window.
9. In A, choose **Return to Lobby**. This ends the active run for everyone, clears cores/scores and resets readiness. A new match begins with zero scores.
10. Leave from A. B becomes host deterministically. Leaving the final member deletes the room.
11. Restart the game server during movement. Once its old 10-second runtime lease expires, the replacement aborts the old session and returns the room to lobby with a clear error; it does not claim that gameplay continued.

For another device on the same LAN, explicitly bind Vite (`pnpm --filter @neon/web dev --host 0.0.0.0`) and server HOST to `0.0.0.0`, use the computer's LAN IP in `VITE_GAME_SERVER_URL`, and add the exact LAN browser origin to `ALLOWED_ORIGINS`. Restart Vite after changing environment. Desktop keyboard controls are included; touch controls are not.

## Checks and production builds

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:local
pnpm exec playwright install chromium
pnpm test:browser
```

Use `pnpm build` with actual production public environment settings for deployment. It rejects loopback game URLs and insecure remote HTTP endpoints. `pnpm build:local` permits explicitly local builds for validation. The browser build is `apps/web/dist/`; the bundled server entry is `apps/server/dist/index.js`. `pnpm start` starts that server with its ignored `.env`. Frontend preview is `pnpm --filter @neon/web preview`; its origin also needs explicit server authorization.

The database suite executes the migration, SQL functions, RLS and role grants using embedded PostgreSQL (PGlite). Auth/API fixtures are test-only. Browser tests run two isolated Chromium contexts against the built production server and Vite frontend, with those SQL-backed fixtures. These results are **not live Supabase verification**. PGlite serializes execution; its competing-final-slot test does not prove multi-connection production lock behavior. Ports 5173, 9100 and 9101 must be free. If your development browser is running, use `NEON_TEST_WEB_PORT=5174 pnpm test:browser`; fixture services remain on 9100/9101. Screenshots/traces go to ignored `test-results/`.

## Preserved development movement route

With Vite development mode and server `NODE_ENV=development`, set `ENABLE_MOVEMENT_TEST_ARENA=true`, then visit `/movement-test`. It preserves Phase 1 behavior and still requires a valid Supabase token. The route is removed from the production browser bundle; roomless gameplay admission is disabled outside the explicit server development setting. There is no production authentication bypass.

## Security and boundaries

Room creation/join/readiness/start/leave/return use security-definer RPCs with identity checks, fixed search paths, explicit grants, request deduplication, revision checks, row locks and database constraints. Exposed tables are member-read-only under RLS. Codes, requests, limits, matches and the server lease live in a non-exposed schema. Do not add `ng_private` to API-exposed schemas.

Authenticated lobby snapshots poll every two seconds; notifications are not a source of truth and no Supabase Realtime channel is needed. Membership snapshots and runtime state are reconciled by the server each second. Movement, cores and scores stay in match-scoped server memory and are never written per tick to Postgres. Removal is enforced at new HTTP session admission and within the next successful server reconciliation for existing HTTP sessions. Database failure stops room movement and closes its sessions; reconnect uses fresh authorization.

Rooms expire after two hours. Cleanup runs while the persistent server is running. Dormant cleanup resumes on the next startup. Lobby membership needs a heartbeat within 30 seconds; active authenticated HTTP sessions also renew existing membership. Missing membership cannot be recreated by the heartbeat. Empty rooms are deleted. A user may hold one active room membership. Stable membership UUIDs serve as server-issued player IDs; HTTP session IDs change on reconnect.

One server process owns a 10-second runtime lease. This phase does not support horizontal scaling. A replacement process aborts old sessions rather than reconstructing them. Movement position memory lasts 15 seconds after session closure; the membership identity survives as long as room membership is valid. Auth is checked at HTTP admission/renewal and token expiration is enforced, but immediate Auth revocation between those checks is not implemented. The client makes one forced refresh attempt after an expired session error.

Phases 3C and 3D add lasers, health, respawn, a round timer and finalized results. Extraction, lockdown, moving sweeps and progressive difficulty are implemented; additional arenas and production deployment remain outside this scope. See the Phase 5A–5C and HTTP migration reports. Physical-device, non-Chromium and dedicated live-project testing remain required. See `docs/phase2-database.md`, `docs/architecture.md` and `docs/phase2-report.md`.

## Phase 3A collection rules

The existing 960×640 arena uses a 24×16 grid with 40-pixel cells and no interior walls. Eight gold cores occupy distinct valid cell centers, excluding player cells and body overlap. Move onto a core to collect it: the server checks a 22-pixel center distance after each 30 Hz movement step. Cores award 100 base points; consecutive pickups within five simulation seconds give 1×, then 2×, then 3×, capped at 3×. The multiplier and combo reset at the exact five-second deadline; points remain. Inactive cores respawn after two simulation seconds with fresh IDs and safe positions. Lower player slot wins an exact same-tick tie.

The snapshot contains cores, authoritative scores/combos and the latest 16 ordered collection events. Clients send no collection or score messages. Scores survive HTTP reconnection while membership and the match remain active, including after the 15-second position grace; position may reset then. Return to Lobby, match abortion or server restart clears the run. See `docs/phase3a-report.md` for verification status, security details and the live two-browser checklist.

## Phase 3B abilities

Dash: **Space** or the HUD button. It uses the last accepted non-zero movement direction from the preceding second; move first if no direction is available. The burst lasts 0.2 simulation seconds at 3× speed (up to 126 pixels), with a five-second cooldown measured from activation. It stays inside the existing solid arena boundary and collects cores through the normal server proximity checks. Shield: **E** or the HUD button, active for two simulation seconds with a twelve-second cooldown from activation. An active shield blocks one laser collision outcome per activation; Phase 3C adds authoritative damage and respawn.

Cooldowns and shield state are owned by the server tick clock. Disconnect stops a dash but preserves its cooldown; shield/cooldowns continue while the match remains active and healthy. Reconnect restores current state, and a new match clears it. Controls ignore keyboard auto-repeat and editable fields. See `docs/phase3b-report.md` for protocol/security, test results and the live checklist.


## Phase 3C and 3D match loop

Lasers warn for 1.5 seconds, activate for one second, and repeat every four seconds after six seconds of opening grace. Each activation applies at most one 50-HP hit or protection block per player. Players start with 100 HP. Death pauses movement, collection and abilities; after three seconds, a safe respawn restores health with 1.5 seconds of protection. Scores persist through death; combos reset.

The server runs a 90-second match by default. Configure `MATCH_DURATION_SECONDS` in `apps/server/.env` (integer 10–3600) and restart the server to change it. The browser receives remaining time and finalized rankings from authoritative snapshots. Final results include score, total cores and competition ranks; tied leaders share victory. Gameplay freezes at completion.

From results, the current host can **Play Again** when at least two members have active HTTP sessions, or **Return to Lobby** even with one remaining member. Replay resets all gameplay and rotates the runtime generation and HTTP sessions while preserving room and member IDs. The database room stays `IN_MATCH` during results/replay; lobby return uses the existing secured RPC through the server. Results and active gameplay recover on reload while that server process remains alive. No results persistence or horizontal scaling is provided. See `docs/phase3c-report.md` and `docs/phase3d-report.md` for validation and live verification instructions.
