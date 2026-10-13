> Current transport: HTTP-only gameplay. Follow [the migration report](http-only-migration-report.md); WebSocket instructions below are historical and superseded. Database fencing, one-replica limits, and secret boundaries remain applicable.

# Production deployment runbook

These configurations are templates. They do not provision or deploy services. Use a controlled test room before admitting players.

## Architecture and prerequisites

Serve the Vite client on Vercel over HTTPS and the authoritative Node server on one persistent Render Web Service. Supabase handles anonymous Auth and durable room membership; gameplay and results remain in server memory. The browser discovers the server from `VITE_GAME_SERVER_URL`, embedded at build time. Changing that value requires a frontend rebuild.

This separate deployment architecture is confirmed. Vercel serves only `apps/web`; do not add Services, bindings, serverless game-server adapters or `/api`/`/ws` proxy rewrites. The browser connects directly to Render's public HTTPS endpoint for authenticated `/game/*` requests. The root `vercel.json` already builds only the frontend and retains the public security headers.

Before deployment, obtain access to the dedicated Supabase project, the hosting accounts, and the repository. Confirm anonymous sign-in is enabled and the existing secure-room migration is applied. Do not reset the database or reapply migrations as part of deployment. Keep `ng_private` outside API-exposed schemas. Verify any additional authenticated Handshake mission restrictions; the public mission evidence in `hosting.md` does not establish those restricted requirements.

Use Node 24.18+ below 25 and pnpm 11.19.0, pinned by `packageManager`. The Render template pins Node 24.19.0. Select the Node 24 runtime on Vercel and enable `ENABLE_EXPERIMENTAL_COREPACK=1`; its install command invokes Corepack to honor the pinned package manager. Verify provider build logs show compatible Node and pnpm versions. Neither provider build has been executed in this phase.

## Environment configuration

| Target | Variables | Requirements |
| --- | --- | --- |
| Vercel browser build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Dedicated project's HTTPS base URL and public publishable/legacy anon key |
| Vercel browser build | `VITE_GAME_SERVER_URL` | Actual public `https://` server origin with a trailing `/`, without credentials, paths, queries or fragments |
| Vercel build tooling | `ENABLE_EXPERIMENTAL_COREPACK` | `1`; package-manager selection only |
| Render server | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Same project and public key as browser |
| Render server only | `SUPABASE_SERVER_KEY` | Project server secret or legacy service-role key; obtain through Supabase project API-key settings |
| Render server | `ALLOWED_ORIGINS` | Comma-separated exact public HTTPS browser origins, without trailing slash; no wildcards |
| Render server | `NODE_ENV`, `HOST`, `PORT` | `production`, `0.0.0.0`, provider-supplied port |
| Render server | `ENABLE_MOVEMENT_TEST_ARENA`, `MATCH_DURATION_SECONDS` | `false`, `90` |

Set server credentials through the provider's secret settings. Never copy a server key into Vercel, a `VITE_` variable, command output, screenshots, or a committed file. Browser keys are public; access tokens are private. Environment validation checks syntax and intended key roles, not whether a credential is accepted by Supabase.

Use the canonical production browser origin. Preview deployment origins are rejected unless individually added to the server configuration. They are not automatically authorized by Vercel domain ownership. HTTP gameplay CORS accepts only the configured exact Origin; each request also requires validated Auth, room membership and a server session. A forged Origin alone cannot authorize a non-browser client.

## Provider setup

1. Reuse the existing persistent Render Web Service. `render.yaml` documents the single-instance settings; do not provision a duplicate server. Never enable autoscaling or multiple replicas.
2. Obtain its actual public HTTPS origin from the Render service dashboard, retaining the trailing `/`; do not infer a hostname from the service name. TLS terminates at the provider; Node listens on its supplied HTTP port.
3. Create a Vercel static project with repository root as its Root Directory and the root `vercel.json`. Configure the three public browser variables and Corepack setting. Its build command builds only `@neon/web`, producing `apps/web/dist`. Set the exact resulting browser origin on Render and restart the service in a controlled window.
4. Check `/health` and `/ready`, then perform the full checklist below. Do not treat a successful provider deployment as multiplayer acceptance.

In Vercel Project Settings → Environment Variables, set `VITE_GAME_SERVER_URL` for Production to that exact Render HTTPS origin, for example `https://neon-grid-server-uske.onrender.com/`. Do not use an internal service binding or the Vercel frontend domain for this variable. Preserve the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; keep `SUPABASE_SERVER_KEY` exclusively on Render. Set the same public game URL for Preview only if its exact browser origins are deliberately authorized on Render. Configuration changes take effect on the next frontend build; do not deploy until the configuration and validation report have been reviewed.

Local `apps/web/.env` remains configured for local development. To check the production frontend locally without editing it, supply the actual `VITE_GAME_SERVER_URL` in the command environment and run `pnpm --filter @neon/web build`. If a persistent local production override is desired, put only that public variable in ignored `apps/web/.env.production.local`; do not duplicate Supabase credentials. Such a file is for local validation and is not uploaded to Vercel or committed.

Render's deployment health path is intentionally `/health`. A replacement process cannot acquire the singleton database lease while the previous process owns it. Waiting for `/ready` before terminating the old process could prevent deployment handoff. This choice allows a short period of HTTP gameplay 503 responses while the old lease expires. Use `/ready` as the post-deployment acceptance check, and schedule restarts outside active matches. This is not uninterrupted deployment.

## Local commands and health checks

Preserve existing ignored environment files; do not copy examples over configured files. With local settings already configured:

```sh
pnpm dev
# Or, in separate terminals:
pnpm --filter @neon/web dev
pnpm --filter @neon/server dev

pnpm typecheck
pnpm test
pnpm build:local
NEON_TEST_WEB_PORT=5174 pnpm test:browser

curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/ready
```

For a configured production build use `pnpm build`, then `pnpm start` for the bundled server. Production builds reject loopback and insecure remote game-server URLs. `pnpm build:local` explicitly permits local fixture builds; it is not the deployment build command. HTTPS pages require an HTTPS game-server origin at runtime. `pnpm start` expects server environment configuration or the existing ignored `apps/server/.env`; it runs no migration.

Production health URLs are the actual server HTTPS origin followed by `/health` and `/ready`. GET/HEAD return 200 for liveness/ready, 503 while closing or not ready; other methods return 405. Bodies contain only status and protocol version, with caching disabled. Readiness requires a successful recent room-authority reconciliation (within five seconds), which exercises the server credential, operational RPC and singleton lease. It does not prove that browser Auth, DNS, TLS or every gameplay feature works. The server returns `503 {"error":"AUTHORITY_UNAVAILABLE"}` from `/game/*` when not ready.

## Controlled live acceptance checklist

Record timestamps, public URLs, HTTP status codes, distinct member IDs and outcomes. Do not record access tokens, API-key headers or provider secrets. Do not export a raw Network HAR.

1. Check public HTTPS `/health` and `/ready` both return 200. Open the public frontend and verify its game connection targets the actual HTTPS `/game/connect` endpoint, not loopback or a WebSocket route.
2. Open two independent browser profiles or normal/private windows with isolated storage. Let anonymous authentication finish. Confirm authenticated RPCs succeed, without displaying token values. Create a uniquely named test room in A, join its code in B, and verify distinct member IDs and `YOU` labels. Ready both; start through A.
3. Move A using WASD and B using arrows. Confirm both see movement and normalized diagonals; releasing controls stops motion. Collect cores and compare authoritative scores, pickup events and combo progression across clients.
4. Exercise Space Dash and E Shield plus their HUD buttons. Confirm cooldowns and protected laser hits agree. Observe warning/activation, damage, death and respawn in both sessions.
5. Let the full default 90-second match finish. Confirm identical finalized rankings, scores and core totals. No movement, pickup or ability action changes completed results.
6. Reload B during a match and at results. Confirm the same member identity and appropriate authoritative state return. Briefly disconnect B and reconnect. Verify A remains distinct and stable.
7. In this controlled room only, use a third authenticated outsider to attempt admission without membership. It must receive no room gameplay snapshots. Existing automated tests cover forged movement/score/lifecycle messages; do not send disruptive traffic to public rooms.
8. Verify only the current host can replay or return everyone to lobby. Replay clears run state and rotates socket sessions; lobby return resets readiness. Host departure transfers host status deterministically.
9. Leave both test members after verification. Confirm a fresh valid connection still works after a test client disconnects. Only during a maintenance window, restart the server and verify the previous in-memory match is aborted after lease expiry and the room returns to lobby with the expected notice.
10. Repeat on separate physical devices and supported browsers. Keyboard movement is implemented; touch movement is not. If the mission requires complete phone gameplay, that remains a release blocker outside this infrastructure phase.

## Operational limits and release gate

One process holds a ten-second database lease; reconciliation runs every second. Horizontal scaling is unsupported. Restarts lose current gameplay and results, disconnect players, and abort prior matches on lease takeover. Position retention after disconnect is fifteen seconds; membership has a separate thirty-second heartbeat window. Auth is checked at admission/renewal and expiration; immediate revocation between checks is not implemented. SIGINT/SIGTERM sends a restart notice and allows a two-second close handshake before terminating lingering connections. Requests already sent to Supabase may finish during shutdown; they cannot repopulate stopped arenas.

Liveness alone does not detect a Supabase outage. Monitor readiness externally and investigate sustained 503 responses without logging credentials. Health responses intentionally omit dependency details. Configure provider log retention and alert routing in the hosting account; no monitoring account or alert destination has been configured here.

**No-go until** real public URLs exist, the provider builds and runtime versions are confirmed, `/ready` is healthy, two independent sessions pass the full 90-second live checklist, and mission/device requirements are resolved. This repository's fixtures do not substitute for those checks.

References: [Render health checks](https://render.com/docs/health-checks), [Render deploys](https://render.com/docs/deploys), [Blueprint specification](https://render.com/docs/blueprint-spec), [Vercel project configuration](https://vercel.com/docs/project-configuration), [Vercel package managers](https://vercel.com/docs/package-managers).
