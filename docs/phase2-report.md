# NEON GRID: CYBER HEIST — Phase 2 Report

Verified October 10, 2026, Asia/Kolkata. Phase 1 baseline: `c6c9913`. The final Phase 2 commit is recorded in the chat; use `git log -1 --oneline` and `git status --short` for current repository state. An intervening local commit was preserved; no existing work was reset.

## Explicit acceptance status

**Implementation and local automated acceptance passed. Dedicated live Supabase acceptance remains pending.** The user-authorized fallback was used because neither environment file nor dedicated project configuration was available. No remote migration, deployment or Phase 3 work occurred.

## Architecture and functionality

- Dedicated-project Supabase anonymous Auth integration remains the identity source. Server token verification remains `getUser(token)` with subject/expiry checks. There is no production test Auth bypass.
- Private room creation/joining, random unique 12-character codes, four slots, callsigns, roster, copy action, ready/unready, host-only start, leave, deterministic host transfer, return to lobby, expiry and cleanup are implemented.
- Host requests one pending match with an authoritative database-issued UUID. The server separately verifies current host/requester, exact frozen roster/revision, everyone ready and at least two active members. The database records the server-controlled start timestamp.
- Lobby snapshots poll every two seconds; server metadata reconciliation runs every second. No Supabase Realtime notification channel is necessary, and no client can write movement state to Postgres.
- Movement stays in the existing fixed-step simulation. Each match owns a separate player map/snapshot stream. Stable database membership IDs become player IDs; socket session IDs and sequences renew on reconnect.
- A ten-second runtime lease fences server ownership. Restart recovery aborts old movement sessions and returns to lobby with an error instead of claiming continuity. Return to Lobby is a host-controlled end to the temporary movement session, without scoring/results.
- Development `/movement-test` preserves Phase 1 behind Vite development mode and an explicit server development flag. Authentication still applies. The production browser bundle excludes that screen.

## Supabase migration and security

`supabase/migrations/20261010000100_secure_rooms.sql` creates exposed `ng_rooms`/`ng_room_members`, member-only SELECT RLS, and private codes/matches/request-cache/rate-limit/runtime tables.

Browser direct INSERT/UPDATE/DELETE grants are revoked. Anonymous unauthenticated execution is denied. Authenticated command RPCs use `auth.uid()`, fixed search paths, explicit execution grants, transactional room locks, user advisory locks, unique constraints, revisions and deduplication. Operational `ng_server_tick` is executable only by the server's operational role. The private schema must remain absent from API-exposed schemas.

The server checks actual user-scoped membership, matching match ID and runtime owner before admission. Removal or match closure disconnects existing sockets on reconciliation. A database outage closes room sockets and neutralizes movement. A member cannot nominate another identity or gain host powers by sending a host ID.

Detailed migration commands, role/grant inspection queries and live acceptance instructions are in `phase2-database.md`. They were not executed remotely.

## Automated results

| Category | Result | What it establishes |
| --- | --- | --- |
| Frozen install | Passed | Final pnpm manifests match committed lockfile |
| TypeScript | Passed | Browser, server, shared packages and tests type-check |
| Phase 1 unit/server regression | 40 passed | Movement, vectors/bounds, protocol, Auth fixture validation, sequences/rates and reconnect behavior preserved |
| Embedded PostgreSQL room/security suite | 16 passed | Migration execution, room creation/codes, capacity, duplicates, ready/unready, starts, RLS/grants, host transfer, expiry, leases, heartbeat/revocation and rate limits |
| Room-aware server integration | 2 passed | Roomless/outsider denial, isolated matches, movement synchronization, reconnect IDs and revocation disconnect using actual SQL RPCs through a test API |
| All automated unit/database/server tests | **58 passed across 6 files** | Combined regression and Phase 2 coverage |
| Phase 1 browser regression | 2 passed | Two isolated Chromium sessions and native socket interruption recovery |
| Phase 2 SQL-backed browser flow | 1 passed | Create, copy, join, distinct membership identities, readiness, host-only start, common active match, both control schemes, reload/reconnect, return and host transfer |
| Browser suite total | **3 passed** | Real isolated browser contexts; fixture-backed Auth/API, not live Supabase |
| Browser production build | Passed | Vite output generated; development movement screen excluded |
| Server production build | Passed | Separate bundled persistent server generated and used in browser tests |
| Visual inspection | Passed | Captured room/movement interface inspected |
| Real Supabase anonymous Auth/token validation | **Not performed** | Requires dedicated project's configuration |
| Native/live multi-connection race test | **Not performed** | PGlite serializes database execution |
| Physical-device / non-Chromium | **Not performed** | Local isolated Chromium verification only |

Tests use PGlite, a real embedded PostgreSQL engine executing the migration and security rules. The Auth schema, JWTs and HTTP Auth/Data API are fixtures, not real Supabase services. The final-slot test submits competing promises but does not prove production multi-connection MVCC behavior. No mocked Auth result is reported as live verification.

The browser flow exposed stale readiness revisions; actions now refetch before mutation, with database conflict checks retained. The SQL-backed fixture exposed and helped fix column-name ambiguities and its missing CORS header allowance. All final suites passed after corrections.

## Files changed or added relative to Phase 1

```text
.gitignore
README.md
package.json
pnpm-lock.yaml
packages/protocol/src/index.ts
packages/protocol/src/rooms.ts
apps/server/.env.example
apps/server/src/index.ts
apps/server/src/rooms.ts
apps/server/src/server.ts
apps/server/src/server.test.ts
apps/server/src/room-server.test.ts
apps/web/src/App.tsx
apps/web/src/MovementTest.tsx
apps/web/src/room-client.ts
apps/web/src/connection.ts
apps/web/src/style.css
supabase/migrations/20261010000100_secure_rooms.sql
tests/database.ts
tests/rooms.test.ts
tests/auth-fixture.ts
tests/browser-services.ts
tests/browser/movement.spec.ts
tests/browser/rooms.spec.ts
docs/architecture.md
docs/phase2-database.md
docs/phase2-report.md
```

`packages/simulation` and the existing arena renderer were preserved. Screenshots/traces/build output remain ignored. Actual `.env` files were not created.

## Required configuration and limitations

Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GAME_SERVER_URL`. Server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, **server-only** `SUPABASE_SERVER_KEY`, `HOST`, `PORT`, `ALLOWED_ORIGINS`, `NODE_ENV`, optional explicit development `ENABLE_MOVEMENT_TEST_ARENA`. See README and `.env.example` files; no secret values are included.

Apply the migration only to a dedicated NEON GRID development project, enable anonymous Auth, configure environment, and follow README's isolated two-client live checklist. Confirm native/live final-slot contention, API RLS/grants and actual access-token rejection there before treating live acceptance as complete.

One persistent server replica; no horizontal scaling, prediction, touch controls or full gameplay. Room expiry is two hours, membership heartbeat 30 seconds, position grace 15 seconds; cleanup needs a running server. Auth revocation is checked at admission/renewal rather than continuously. Membership removal has a bounded reconciliation delay. No confirmed hosting blocker; detailed mission hosting restrictions remain unverified behind login. Render Web Service remains the proposed persistent host.

Stopped after Phase 2. Await approval before Phase 3.

## Subsequent verification and Phase 3A

The Phase 3A request reports successful live Phase 2 testing against the dedicated Supabase project: two-session rooms, movement, host controls, reconnect and membership restrictions. This is user-reported verification after the historical local-only report above. Phase 3A preserves that foundation; its own fixture-backed checks are described in `phase3a-report.md` and are not live Supabase evidence.
