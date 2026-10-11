# Phase 4 — production readiness and verification

Date: October 11, 2026. Baseline: `4261d3c`. Scope: infrastructure, configuration, security verification and operating instructions; no new gameplay or production deployment.

## Architecture audit before changes

The existing React/TypeScript/Vite client renders Canvas 2D and uses Supabase anonymous Auth. Authenticated room RPCs manage durable room membership. A separate Node/TypeScript WebSocket process validates Supabase identities and room membership, owns the fixed-step simulation, and reconciles the singleton lease through `ng_server_tick`. Gameplay, cooldowns, health, match completion and results remain in match-scoped memory. The browser sends intentions, not positions or scores.

Reviewed the Phase 3A–3D reports, hosting/architecture documentation, existing migration and RLS/grants, source configuration, Auth/session handling, RPC calls, tests and build/start scripts. Initial Git status contained only two unrelated untracked files, `supabase/.gitignore` and `supabase/config.toml`; they are preserved and excluded from this commit.

There was no Vercel project link, provider deployment configuration or recorded production client/server URL. Existing documentation proposed a persistent Render server. Local web/server environment files were present and Git-ignored. Both configured Supabase base URLs matched the dedicated project `tlzvrtpksyirnckwdprf`; public keys and a server-only key were present. The browser game URL was loopback. This inspection establishes configuration presence and project URL consistency, not credential validity or live authentication. No secret value is included here.

The existing `/health` checked process liveness but did not distinguish dependency readiness. Startup validated some configuration; it did not fully reject insecure production origins/URLs. Shutdown immediately terminated sockets and lacked a bounded HTTP drain. Existing protocol validation, membership isolation, input-rate limits, sequence/session validation and authoritative gameplay checks were already implemented and retained.

## Implemented changes

- Shared pure configuration validators in `packages/protocol/src/configuration.ts` enforce public key roles, URL syntax, `/ws`, HTTPS/WSS compatibility and explicit local-build exceptions. Browser runtime configuration uses the same validation. Vite rejects browser-prefixed secret/server-key variables and recognizable secret values before building.
- `apps/server/src/config.ts` validates all required startup fields, server key role, exact HTTP(S) origins, port/bind address, match duration and development-only movement arena. Production rejects local/insecure origins and HTTP Supabase settings. Errors name configuration requirements without printing values. Startup bind failures produce a generic actionable error and stop cleanly.
- `/health` remains liveness; `/ready` requires recent successful room-authority reconciliation and a listening, nonclosing process. It returns 503 until ready and on dependency failure/staleness. New socket admission also fails closed while not ready. HTTP responses reveal only status/protocol and support GET/HEAD with meaningful 200/503/405/404 statuses. Request/header/keep-alive bounds are configured.
- Graceful shutdown is idempotent, stops timers/simulation, clears retained access tokens and movement, sends `SERVER_CLOSING`, closes sockets with 1012, and forces lingering sockets/HTTP connections closed after two seconds. Asynchronous callbacks cannot repopulate stopped state.
- Repository-root `vercel.json` and `render.yaml` provide static frontend and single persistent server templates. Render automatic deploys are disabled; one paid instance is specified. No provider account/resource was created. Corepack honors the committed pnpm version; the server template pins a compatible Node version.
- `pnpm build:local` provides an explicit local validation build. Standard `pnpm build` requires production-safe endpoints. Browser fixture tests use the local build command; production provider configuration does not.
- `.gitignore` additionally excludes Vercel metadata and private-key file extensions. Local environment files were not changed. No dependency or lockfile change was necessary. No database migration, grant or RLS change was made.

New tests cover startup/build environment rejection, safe health/readiness responses and dependency failure, unavailable-server admission, origin rejection, oversized/binary messages, heartbeat cleanup, graceful/idempotent shutdown and forced HTTP drain. A real production browser build with synthetic public values verifies that a server-only sentinel credential is absent from assets and rejected if accidentally browser-prefixed. The existing room-server test now waits for readiness before exercising its unchanged authorization assertions.

## Deployment prerequisites and instructions

See [deployment runbook](deployment.md) for exact provider configuration, environment fields, local and production commands, health URLs and the two-session live checklist.

Public browser fields: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GAME_SERVER_URL`. Server fields: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, server-only `SUPABASE_SERVER_KEY`, `ALLOWED_ORIGINS`, `NODE_ENV`, `HOST`, `PORT`, `ENABLE_MOVEMENT_TEST_ARENA`, `MATCH_DURATION_SECONDS`. Vercel tooling uses `ENABLE_EXPERIMENTAL_COREPACK=1`. Supply real public HTTPS/WSS endpoints and exact allowed origins through provider settings, then rebuild the frontend.

Required user/infrastructure actions: provision or identify the canonical public frontend and persistent server; configure provider secrets and public settings; confirm the dedicated project's anonymous Auth/migration/private-schema settings; confirm provider runtime compatibility; check any restricted mission rules; execute the controlled production checklist. The project-local settings are not a deployment configuration.

Render uses `/health` during replacement deployment because `/ready` cannot succeed while the previous instance holds the singleton lease. Check `/ready` after handoff and expect a short unavailable interval. No claim of uninterrupted deployment is made. Public health checks are `<actual-server-HTTPS-origin>/health` and `/ready`; local equivalents are `http://127.0.0.1:8787/health` and `/ready`.

Local startup: `pnpm dev`, or separate `pnpm --filter @neon/web dev` and `pnpm --filter @neon/server dev`. Production: configured `pnpm build`, then `pnpm start` for the bundled server; Vercel serves the frontend build. Startup performs no database migration.

## Commands and actual validation

Node 24.19.0 and pnpm 11.19.0 were used. Existing dependencies were used; no install, deployment or reset was run.

| Command/check | Actual outcome |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | 204 tests passed across 19 files; 34.77 seconds |
| `VITE_GAME_SERVER_URL=wss://production-build-check.example.com/ws pnpm build` | Web and bundled server builds passed; synthetic endpoint only, no deployment/connectivity claim |
| `pnpm build` with preserved local environment | Rejected as intended because its game-server URL is loopback; production safety guard verified |
| `pnpm build:local` | Web and server builds passed as part of browser suite |
| `NEON_TEST_WEB_PORT=5174 pnpm test:browser` | All 10 Chromium tests passed in 2.6 minutes, including two independent contexts for movement, room lifecycle, collection, abilities, hazards and results |
| `git diff --check` | Passed |
| `git check-ignore apps/web/.env apps/server/.env` | Both local environment files remain ignored |

An initial full test run found two setup issues: the room test raced the new readiness gate, and a child Vite build inherited `NODE_ENV=test`. Tests now wait for actual readiness and explicitly build with `NODE_ENV=production`. Existing gameplay/security assertions were retained. The complete automated suite subsequently passed.

## Evidence and remaining live checks

Automated tests use isolated local PGlite, Auth/RPC fixtures and WebSockets. They verify room isolation, identity/expiry enforcement, malformed input and rate rejection, stale session/sequence rejection, authoritative movement/collection/abilities/hazards/results and reconnection. All ten browser tests passed, including explicit independent Chromium contexts and actual socket interruption/recovery. Auth tests also confirm that room RPCs wait for anonymous sign-in, failed signup is visible, and permission denial stops background polling. PGlite execution is serialized and does not establish production multi-connection PostgreSQL lock behavior.

No live Supabase Auth attempt or room creation was performed in this phase. No public WSS, TLS, provider deployment, provider restart, physical device or complete live 90-second match was verified. Production URLs were unavailable. The browser suite uses independent Chromium storage contexts with local Auth/SQL fixtures and a shortened test match; it cannot prove production connectivity or the default duration.

## Known limits and recommendation

**NO-GO for public production acceptance.** Local validation and configuration templates are ready for provider review, but real endpoints and the complete live checklist remain required. Existing credentials were not remotely validated; hosting access, DNS/TLS, provider configuration and restricted mission requirements remain unverified.

Only one server process may own the ten-second lease; horizontal scaling is unsupported. Server restart loses active gameplay and results and aborts prior matches on lease takeover. Reload/reconnect restores state only while the owning process retains it. Position retention is fifteen seconds, membership heartbeat thirty seconds. Immediate Auth revocation between admission/renewal checks is not implemented. Readiness monitoring and alerts must be configured externally; liveness alone does not detect a Supabase outage. Touch movement remains unimplemented, so any mandatory complete phone gameplay requirement is still a release blocker outside this phase.

No Phase 5 work, production deployment, migration or secret-file change was performed.
