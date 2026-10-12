# HTTP-only gameplay migration

## Architecture and request flow

The migration reuses the current simulation/UI and replaces transport only. The production Node entrypoint has no WebSocket upgrade listener or subscriptions. React/Canvas uses authenticated fetch and polling. Supabase supplies existing Auth and HTTP PostgREST room RPCs, never Realtime subscriptions.

The existing 30 Hz simulation remains authoritative for movement, eight cores/combos, Dash/Shield, health/damage/death/respawn, warnings/moving sweeps/progressive difficulty, the default 90-second match, extraction/lockdown, results/ties, replay and lobby reset. No gameplay ticks/positions are written to Postgres, and clients submit no authoritative outcome.

## HTTP endpoint contract

All routes require exact allowed Origin and Bearer token. Stateful requests require X-Game-Session. Responses are no-store JSON messages validated by the shared protocol. Credentials never appear in URLs. Exact-origin OPTIONS preflight supports GET/POST and the required headers; no wildcard or cookie credentials are used.

| Endpoint | Request and behavior |
| --- | --- |
| POST /game/connect | {requestId,roomId,matchId}: verify identity and current membership/authority; return welcome/current snapshot. Development movement arena allows {requestId}. Identical token/body/requestId retries coalesce one session, including concurrent requests. |
| POST /game/resume | {}: recover an authenticated session after reload immediately, preserving player state/ability timing and sequencing. A changed access token must verify as the same identity. |
| GET /game/state | Current authoritative snapshot, no client-owned clock or action. |
| POST /game/step | {actions:[input/ability/lifecycle envelopes]}, maximum eight; validate session/sequence/intent, process once and return current state/events. Empty actions is a pure poll. |
| POST /game/renew | {}: verify refreshed token remains the same player and room. |
| POST /game/disconnect | {}: close logical session, neutralize movement and cancel Dash through existing cleanup. |

Create/join/recover/ready/start remain ng_create_room/ng_join_room/ng_get_room/ng_set_ready/ng_request_start HTTP RPCs. Core collection is automatic after authoritative movement; there is no pickup/score/damage endpoint. Host replay/return are validated lifecycle intents; return uses existing user-scoped ng_return_lobby.

Statuses: 400 forged/malformed; 401 missing/expired/wrong session; 403 Origin/member denial; 404 unknown route; 405 method; 409 conflict/protocol rejection; 413 oversized body; 429 rate/capacity; 503 authority/Auth unavailable. Typed protocol errors remain in messages where applicable. Ability/lifecycle semantic rejection is nonterminal feedback.

## Polling, simulation and retry strategy

Active polls start after request completion plus 100 ms; results use 600 ms; lobby metadata retains two-second polling. Round-trip latency adds to those minimum gaps. Input and actions are batched with state retrieval, not sent every animation frame. Keyboard changes trigger one immediate request if none is in flight. There are no overlapping client requests. Fetch timeout is five seconds; error backoff grows from 500 ms to eight seconds.

Malformed responses and older same-generation snapshots are rejected. Recoverable status explains authority/connection unavailability; Linking match clock is removed. Reload stores only server session ID and next action sequence in sessionStorage, never positions, scores, timers or outcomes. Immediate resume preserves a shield's remaining two-second window. Explicit disconnect removes transport metadata.

HTTP inactivity expires logical sessions after three seconds. Movement still stops after the original 250 ms input timeout. Position grace remains fifteen seconds, membership lifetime thirty seconds, and extracted position retention unchanged. Lost-response retries reuse identical action sequence/body. The server remembers 128 accepted action encodings per session; exact duplicates do not repeat ability/replay effects. Conflicting bodies receive 409; older uncached actions retain stale-sequence rejection. Replay invalidates old sessions and clients recover the fresh generation.

## Authorization, limits and concurrent rooms

Request limit: 8192 bytes, eight actions, 32 active sessions, 120 pre-session requests per remote address per second and 60 per authenticated session per second (independent budgets behind ingress/NAT), plus the existing intent token bucket (burst 90/refill 60 per second). Exact-key parsing rejects forged positions/scores/pickups/health/hazards/results. Session caches, response queues and rate maps are bounded. Server-verified tokens are bound to identity until expiry; every request checks binding, expiry and readiness. Connect/renew verifies Auth, roster reconciliation removes revoked membership every second, and lifecycle checks separately authorize the current host.

Requests serialize actions per session with BUSY on concurrent processing; different rooms remain isolated arenas served by the same fixed-step authority. Auth, RLS, migrations and server-key boundaries remain unchanged. HTTP rejection categories and readiness diagnostics are bounded and exclude keys/tokens/headers/raw URLs/user/room data/error text.

## Ownership, restart and recovery limits

The existing Postgres singleton is retained as a database authority fence, not a WebSocket connection. The schema binds matches to server_instance and gameplay/results are memory-only; removing fencing would permit split-brain and require a separately reviewed ownership migration.

A real isolated PGlite/migration HTTP integration test verifies a competing authority receives 503/lease_busy; after owner shutdown and expiry takeover, old matches return to lobby and the old match is denied. It advances only its test database expiry to avoid a ten-second wait. Production leases are untouched. Native multi-connection Postgres contention remains a manual gate because PGlite execution is serialized.

One active persistent authority is supported. Parallel active replicas, seamless restarts, durable gameplay/results and serverless per-request simulation are not claimed. A separately approved unwanted-owner stop and natural ten-second expiry/reconciliation are still required for production lease contention. Never delete/replace a production lease or bypass readiness. HTTP migration alone cannot evict a renewing competitor.

## Preserved work and remaining WebSocket references

Initial main HEAD da5828e contained modified server.ts/operations.test.ts/room-server.test.ts/connection.test.ts and two untracked investigation reports. Their original test bodies/reports are preserved. The original transport server/client/configuration is retained in explicitly named legacy-websocket files, imported exclusively by historical regression tests and absent from the production entrypoint/application graph.

ws is now a server development dependency solely for those tests; the pinned lockfile was updated offline. Historical reports keep their URLs. Current deployment/hosting/architecture documents point here; current examples use HTTP. Existing socket-form environment values normalize in memory to an HTTP(S) base URL as compatibility only, without opening sockets. Real environment files and provider settings were not edited.

Vite development HMR may use a tooling socket unrelated to gameplay; production static builds omit HMR, and the browser tests block socket creation even for development tooling.

Supabase SDK dependencies may contain Realtime/WebSocket code, but the game invokes only Auth/PostgREST and never subscribes. Executed browser contexts replace WebSocket with a throwing constructor and reject observed socket connections; gameplay must succeed without them.

## Validation

- New focused HTTP contract/client/server/fencing/resume coverage: 21 tests passed across four files in 16.76 seconds.
- Initial two-browser room/results checks: two passed in 1.4 minutes, including finish/replay/lobby through HTTP with sockets blocked.
- Initial full browser run: seven passed, four failed, one intentionally skipped. Reload waited for idle-session expiry, losing the short shield window and crossing later damage phases; later reload checks also encountered client/server versions changing during implementation. Authenticated immediate resume and a fresh fixture build fixed recovery.
- Final standard browser suite: 11 passed, one intentionally skipped, in 3.1 minutes. The skip is the moving test in deliberately short matches.
- Dedicated 45-second moving-hazard browser run: one passed in 51.2 seconds (41.9-second scenario). Combined executed browser coverage is twelve passing scenarios, with WebSocket construction blocked.
- Initial unit fixture corrections: compare same-tick read-only snapshots rather than acknowledged sequences after different actions; use a genuinely malformed response type instead of a finite coordinate accepted by the existing snapshot parser.
- First full automated migration run: 286 passed, one failed because the production-build assertion still expected the WSS error. That assertion now validates HTTPS while keeping the secret-exclusion checks.
- Final complete suite after the last backoff guard: 287 tests passed across 30 files in 107.41 seconds. Command: pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000. No final failures remain.
- TypeScript passed on the final implementation. Final keyboard/blur/offline/reload browser repeat: two passed in 23.0 seconds (already included in the twelve distinct scenarios, not extra unique coverage).
- Both production builds passed using a process-only HTTPS game-server URL override; local fixture builds also passed.
- Offline lockfile update passed; no new dependency/version was introduced. ws moved to development use.
- Production server bundle/source search found no WebSocketServer, handleUpgrade, new WebSocket or Realtime subscription in the active transport. Remaining historical/test-only/configuration/SDK references are explained above.
- Git diff whitespace checks passed; final complete diff review and exact changed-file list follow.
- Production, physical-device and non-Chromium validation were not performed.

## Local verification

Use Node 24.18+ and pnpm 11.19:

~~~sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
pnpm build:local
NEON_TEST_WEB_PORT=5174 pnpm exec playwright test
NEON_TEST_MATCH_SECONDS=45 NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/moving-lasers.spec.ts
~~~

Tests start isolated Auth/Postgres fixtures and the actual bundled HTTP server on 9100/9101; production Supabase and local user processes are untouched.

For ordinary play, use private Supabase configuration and exactly one authority for that project. Run pnpm --filter @neon/server dev and pnpm --filter @neon/web dev. Recommended VITE_GAME_SERVER_URL is http://127.0.0.1:8787/; previous socket-form local values normalize without editing files. In independent browser profiles create/join, ready/start, move/collect, shield a laser, reload during an ability, finish, compare results, host replay and lobby return. Network must show /game Fetch/XHR and no gameplay WS traffic.

## Production approval and verification

No commit, deploy, process stop, provider change, migration, policy/Auth setting, secret or real environment file changed.

1. Review the diff/results and approve coordinated server/frontend release; use one persistent Node authority.
2. Identify the production lease owner and approve a controlled handoff separately. Allow natural expiry; expect old matches to reset. Require /health and /ready 200 with authority_recovered/ready diagnostics.
3. Preserve Supabase settings and exact production Origin. Recommended browser base URL is https://neon-grid-server-uske.onrender.com/; normalization also accepts the previous secure socket value. Any production setting edit requires approval/rebuild; none occurred.
4. In two profiles create/join a fresh room, ready/start. Require /game/connect and /game/step success, valid welcome/snapshots, distinct IDs, matching positions and advancing clocks. No WebSocket or Realtime traffic.
5. Verify cores/combo, abilities, damage/death/respawn, four sweeps from 30 seconds, pressure at 60, extraction immunity, default 90-second lockdown, ranked/tied results.
6. Reload during shield/motion and briefly go offline/online. Verify recovery, stable identity and no duplicate abilities/replay; exercise host-only replay/nonhost denial/lobby reset.
7. During approved maintenance, verify restart/expiry returns old rooms to lobby, without claiming durable state or multi-instance scaling.

Production, physical-device and non-Chromium acceptance remain unverified. No touch/audio added. High latency can reduce updates/movement continuity because the original 250 ms safety timeout is preserved. No optimistic gameplay or balance workaround is introduced.

## Exact changed-file list

- README.md
- apps/server/build.mjs
- apps/server/package.json
- apps/server/src/ability-server.test.ts
- apps/server/src/gameplay-server.test.ts
- apps/server/src/hazard-server.test.ts
- apps/server/src/http-peer.ts
- apps/server/src/http-restart.test.ts
- apps/server/src/http-server.test.ts
- apps/server/src/legacy-websocket-server.ts
- apps/server/src/lifecycle-server.test.ts
- apps/server/src/moving-hazard-server.test.ts
- apps/server/src/operations.test.ts
- apps/server/src/room-server.test.ts
- apps/server/src/server.test.ts
- apps/server/src/server.ts
- apps/web/.env.example
- apps/web/src/App.tsx
- apps/web/src/connection.test.ts
- apps/web/src/connection.ts
- apps/web/src/http-connection.test.ts
- apps/web/src/legacy-websocket-connection.ts
- docs/architecture.md
- docs/deployment.md
- docs/hosting.md
- docs/http-only-migration-report.md
- packages/protocol/src/configuration.test.ts
- packages/protocol/src/configuration.ts
- packages/protocol/src/http-configuration.test.ts
- packages/protocol/src/index.ts
- packages/protocol/src/legacy-websocket-configuration.ts
- playwright.config.ts
- pnpm-lock.yaml
- tests/browser/abilities.spec.ts
- tests/browser/auth.spec.ts
- tests/browser/extraction.spec.ts
- tests/browser/gameplay.spec.ts
- tests/browser/hazards.spec.ts
- tests/browser/http-test.ts
- tests/browser/movement.spec.ts
- tests/browser/moving-lasers.spec.ts
- tests/browser/results.spec.ts
- tests/browser/rooms.spec.ts
- tests/production-build.test.ts

Existing untracked match-clock and 403 reports are excluded from this list because they remain unchanged. Original modified test bodies remain intact; their imports now target the historical transport. The server investigation implementation is preserved in the archived server. No files are staged.

## Final review state

Main remains at da5828e. 34 tracked files are modified and 12 files are untracked (including the two preserved reports). No files are staged. Complete tracked diff and new sources/reports were reviewed; git diff --check passed. No unrelated file was reset or discarded.

~~~text
 M README.md
 M apps/server/build.mjs
 M apps/server/package.json
 M apps/server/src/ability-server.test.ts
 M apps/server/src/gameplay-server.test.ts
 M apps/server/src/hazard-server.test.ts
 M apps/server/src/lifecycle-server.test.ts
 M apps/server/src/moving-hazard-server.test.ts
 M apps/server/src/operations.test.ts
 M apps/server/src/room-server.test.ts
 M apps/server/src/server.test.ts
 M apps/server/src/server.ts
 M apps/web/.env.example
 M apps/web/src/App.tsx
 M apps/web/src/connection.test.ts
 M apps/web/src/connection.ts
 M docs/architecture.md
 M docs/deployment.md
 M docs/hosting.md
 M packages/protocol/src/configuration.test.ts
 M packages/protocol/src/configuration.ts
 M packages/protocol/src/index.ts
 M playwright.config.ts
 M pnpm-lock.yaml
 M tests/browser/abilities.spec.ts
 M tests/browser/auth.spec.ts
 M tests/browser/extraction.spec.ts
 M tests/browser/gameplay.spec.ts
 M tests/browser/hazards.spec.ts
 M tests/browser/movement.spec.ts
 M tests/browser/moving-lasers.spec.ts
 M tests/browser/results.spec.ts
 M tests/browser/rooms.spec.ts
 M tests/production-build.test.ts
?? apps/server/src/http-peer.ts
?? apps/server/src/http-restart.test.ts
?? apps/server/src/http-server.test.ts
?? apps/server/src/legacy-websocket-server.ts
?? apps/web/src/http-connection.test.ts
?? apps/web/src/legacy-websocket-connection.ts
?? docs/http-only-migration-report.md
?? docs/match-clock-investigation.md
?? docs/production-websocket-403-investigation.md
?? packages/protocol/src/http-configuration.test.ts
?? packages/protocol/src/legacy-websocket-configuration.ts
?? tests/browser/http-test.ts
~~~
