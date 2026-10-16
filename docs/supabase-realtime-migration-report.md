# Supabase Realtime and WebSocket migration report

## Decision

The active game transport is restored to the existing direct authenticated WebSocket protocol. `apps/web` opens an exact `wss://…/ws` endpoint after Supabase anonymous Auth has supplied an access token; `apps/server` verifies that token with Supabase, authorizes the active room membership with secure RPCs, and owns the fixed-step simulation.

Supabase Realtime Broadcast was evaluated but is not used as the authoritative transport. The current Supabase schema has no Realtime publication, Broadcast authorization policy, or durable simulation-state model. More importantly, Broadcast cannot make a browser-supplied movement, score, damage, pickup or lifecycle event trustworthy. Database RPCs are transactional rather than a persistent 30 Hz simulation host, and Edge Functions are request-bound and cannot safely replace a single long-lived match loop. Adding Broadcast would create a second untrusted messaging plane without removing the one process that must own tick order, collision resolution, reconnect state and match finalization.

The smallest reliable design is therefore one persistent Node authority, with Supabase providing the managed services it is suited to: Auth identity verification, RLS-protected room membership, secure room RPCs and the existing database runtime fence. Realtime may later be added for non-authoritative lobby presence after a separate private-channel authorization migration and load test; it must never be accepted as gameplay authority.

For hosting, a managed persistent game service such as the existing single-instance Render Web Service is appropriate because it can retain the in-memory arena and fixed-step loop between messages. Supabase Edge Functions are appropriate for bounded RPC work, but their request lifecycle, concurrency model and restart behavior make them unsuitable for ownership of a persistent 30 Hz match. The persistent service is therefore an explicit, retained dependency rather than a hidden Realtime or Edge Function substitute.

## Implementation plan completed

1. Restore the retained WSS server/client protocol as the active application entrypoints.
2. Keep Supabase Auth and `ng_get_room` authorization before player allocation; retain the existing singleton lease and server-owned simulation.
3. Restore production WSS configuration validation and deployment documentation.
4. Keep the HTTP transport, tests and reports as historical/regression code while removing it from the production entrypoint.

## Changed files

- `apps/server/src/index.ts` imports the retained WebSocket authority.
- `apps/server/build.mjs` externalizes `ws`; `apps/server/package.json` and `pnpm-lock.yaml` classify `ws@8.22.0` as a production dependency so the ESM bundle can load it safely at runtime.
- `apps/web/src/App.tsx`, `MovementTest.tsx` and `auth.ts` select the WebSocket client and its strict WSS environment validator.
- `packages/protocol/src/index.ts` exports the explicit WebSocket configuration validator without changing the historical HTTP validator.
- `apps/web/.env.example`, `playwright.config.ts`, browser helpers and production-build checks use the WSS endpoint format.
- `docs/deployment.md`, `docs/architecture.md`, `docs/hosting.md` and `README.md` describe the active WSS architecture.

## Security and authority

The client sends only movement intent and ability/lifecycle intent. The server validates message shape, session ID, increasing sequence, input rate, token identity, exact Origin, room membership and active database-owned match instance. It alone advances the 30 Hz simulation and broadcasts 15 Hz snapshots. The server alone awards cores/combo/bonus score, applies hazards, health/death/respawn/shield logic, controls extraction/lockdown, finalizes results and accepts replay/lobby actions. Reconnects issue a new session while preserving a bounded authoritative player grace state.

Supabase browser credentials remain public publishable credentials only. The server-only key remains exclusively in the persistent authority for `ng_server_tick`; no service key, access token, raw Origin, payload or room identifier is logged by transport diagnostics.

## Supabase requirements

- Anonymous sign-in enabled.
- Existing `20261010000100_secure_rooms.sql` migration applied; it enables RLS on both public room tables, grants room RPCs only to `authenticated`, grants `ng_server_tick` only to `service_role`, and keeps `ng_private` unexposed.
- Render has the same Supabase URL/public key as the browser plus its private server key, one replica, and an exact `ALLOWED_ORIGINS` list containing the production Vercel origin without a trailing slash.
- Vercel Production builds with `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws`. This is a required deployment setting, not a change made by this migration.

## Validation

- TypeScript check passed. The production WSS build, local fixture build, and `git diff --check` passed after the final browser-test changes.
- Focused WebSocket client, Auth, room authorization, authority diagnostics, movement, Dash, Shield, moving-hazard and lifecycle tests: 75 tests across 9 files passed. Client/protocol/simulation/production-build regressions: 167 tests across 20 files passed. Additional readiness and historical HTTP regressions: 47 tests across 5 files passed. The 16 embedded-Postgres room cases were then rerun individually because a combined PGlite process exceeds the command window; every case produced an explicit passing Vitest summary. This is 305 completed unit/integration assertions across those groups.
- The first browser run exposed an ESM bundling fault in `ws` (`Dynamic require of \"events\" is not supported`). Externalizing `ws` fixed fixture startup. The four initially outstanding WSS scenarios then passed in isolated browser runs: room create/join/ready/start plus reload/lobby return (1); two-client movement, key release, explicit disconnect/reconnect and reload identity recovery (1); blur-cleared movement (1); and Dash/Shield/cooldown/reload/lobby return (1). The hazard flow also passed: two clients observed warning/active phases, shield protection, damage, death, respawn, reload recovery and lobby reset. The extraction flow passed at its documented 20-second fixture duration: extraction, reload, lockdown, results agreement, replay and lobby return.
- The moving-sweep scenario passed with `NEON_TEST_MATCH_SECONDS=45` in 54.0 seconds. It captured `framereceived` WebSocket snapshots from both clients and verified the stage-2 warning and active sweep presentation, motion, matching hazard snapshots, reload recovery, narrow layout, and lobby return. The results/replay scenario passed in 1.1 minutes: both clients agreed on results, reloaded results recovered, replay reset the run, and the second match returned to the lobby.
- The browser offline toggle was removed as a transport-failure assertion because Chromium does not reliably sever an already-open loopback WebSocket. Reconnect coverage remains the explicit disconnect/reconnect and page reload identity recovery scenario; server-side connection/reconnect behavior is covered by the unit suite.

Commands completed in this verification:

```sh
CI=true pnpm build:local
CI=true NEON_TEST_WEB_PORT=5181 pnpm exec playwright test tests/browser/rooms.spec.ts
CI=true NEON_TEST_WEB_PORT=5182 pnpm exec playwright test tests/browser/movement.spec.ts
CI=true NEON_TEST_WEB_PORT=5183 pnpm exec playwright test tests/browser/abilities.spec.ts
CI=true NEON_TEST_WEB_PORT=5184 pnpm exec playwright test tests/browser/hazards.spec.ts
CI=true NEON_TEST_WEB_PORT=5185 pnpm exec playwright test tests/browser/extraction.spec.ts
CI=true NEON_TEST_MATCH_SECONDS=45 NEON_TEST_WEB_PORT=5187 pnpm exec playwright test tests/browser/moving-lasers.spec.ts
CI=true NEON_TEST_WEB_PORT=5188 pnpm exec playwright test tests/browser/results.spec.ts
CI=true pnpm exec vitest run apps/web/src/*.test.ts packages/protocol/src/*.test.ts packages/simulation/src/*.test.ts tests/production-build.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
CI=true pnpm typecheck
CI=true VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build
CI=true pnpm build:local
git diff --check
```

`CI=true pnpm test` initially exposed six default-limit timeouts in long HTTP/PGlite compatibility cases. The affected assertions and setup hooks now declare local 30-second or 45-second limits, based on their observed 10–38 second duration under parallel load; the global 10-second default remains unchanged for the rest of the suite. The exact full command then passed: 34 files and 299 tests in 41.42 seconds. `CI=true pnpm typecheck`, `CI=true VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`, and `git diff --check` also passed.

The room file was executed as sixteen named, isolated `vitest -t` cases because the one-process PGlite file run exceeds the local command window. Each case passed; that workaround does not modify the migration or database fixture.

No live Supabase Realtime channel, production deployment, provider configuration, database migration, RLS policy, environment file or production lease was changed.

## Production verification checklist

1. Review this change, then deploy matching server and frontend revisions together in a maintenance window; do not run the HTTP and WSS application versions as a mixed release.
2. Set Vercel `VITE_GAME_SERVER_URL` to the exact WSS endpoint and ensure Render `ALLOWED_ORIGINS` includes exactly the Vercel production origin.
3. Identify any competing authority before deployment. Require repeated `/health` and `/ready` HTTP 200 responses; do not delete or overwrite the lease.
4. Confirm a production-Origin `/ws` upgrade returns 101, then use two isolated authenticated browser sessions to create/join, ready/start, and receive matching snapshots.
5. Verify synchronized movement, core/power-up scoring, moving hazards, Dash/Shield, death/respawn, extraction/lockdown/results, reload/reconnect, replay and lobby return. Confirm server diagnostics contain no sensitive data.

Production acceptance is pending the preceding production checks. A persistent authoritative process remains required; Supabase Realtime has not been represented as a replacement for it.
