# Production WebSocket investigation

No commit, deployment, process restart, environment-file change, database migration or RLS change was performed.

## Verified observations

Token-free live probes returned:

| Check | Result |
| --- | --- |
| Public frontend | HTTP 200; bundle contains `wss://neon-grid-server-uske.onrender.com/ws`, without the local game endpoint |
| Render `/health` | HTTP 200, `{"status":"ok","protocol":1}` |
| Render `/ready` | HTTP 503, `{"status":"not_ready","protocol":1}` |
| Render `/ws` with production Origin `https://neon-grid-tau.vercel.app` | HTTP 403 before upgrade; no 101 |
| Render `/ws` with either documented local Origin | HTTP 403 as well |
| Existing local server port 8787 | Listening; `/health` and `/ready` both HTTP 200 |

These probes signed in no user, sent no token, created no room and immediately closed any socket. No complete production multiplayer verification was performed. The local server configuration targets the dedicated game Supabase project. Its healthy readiness and the singleton lease make competing local authority a plausible explanation for Render's readiness failure, but do not establish Render's actual project/key configuration or RPC error. The local process was preserved.

## Evidence from source

`server.ts` creates one HTTP server and attaches `upgrade` to it. Exactly `/ws` reaches `WebSocketServer.handleUpgrade`; no handler or separate socket port is missing. `config.ts` honors `PORT`, with production fallback 10000 and development fallback 8787. Production defaults to external bind `0.0.0.0`; `index.ts` listens on the validated host and port.

Admission checks shutdown, exact path, exact Origin allowlist and the 32-connection cap before readiness. Each can produce 403; readiness then produces 503 when authority reconciliation is unhealthy/stale. Browser Auth is sent only after a successful upgrade, so the reproduced 403 precedes browser token and membership validation in this implementation. The separate readiness gate does depend on Supabase server operations.

The WSS URL is already valid and ends in exactly `/ws`. Configuration rejects credentials, query strings, fragments and incompatible HTTPS/WS combinations. The browser uses the URL directly. `App.tsx` keys and cleans up its connection effect by room/status/match. Repeated socket requests are intentional retries and do not prove URL duplication.

The existing migration's `ng_server_tick` returns `SERVER_BUSY` while another process owns the ten-second runtime lease. Local and production authorities must not run simultaneously against the same project. This policy was not changed.

## Root cause and uncertainty

**Established:** transport admission fails with 403, and authority readiness independently fails with 503. The frontend URL and repository's port/upgrade implementation are correct.

**Unconfirmed:** the exact deployed 403 branch, active Render allowlist, deployed commit, server credentials/project and actual readiness RPC failure. Origin mismatch is a candidate, not a proven conclusion; competing local authority is a candidate for the separate 503. A provider-side rejection remains possible until application upgrade logs prove arrival at Node. Requested non-secret evidence is `ALLOWED_ORIGINS`, `NODE_ENV` and deployed commit hash; no keys or tokens are needed.

## Prepared changes

- Bounded server diagnostics identify received/accepted upgrades, rejection reason, malformed handshake, socket errors, close codes and protocol rejection codes. Connection events are limited to 60 per minute plus one suppression event; readiness/authority events use an independent budget of the same size (see the readiness investigation follow-up).
- Logs omit raw URLs, Origins, headers, error text, user/room IDs, payloads, credentials and tokens.
- Authority failures are classified as `lease_busy`, `rpc_permission`, `rpc_failure`, `invalid_response` or `unknown`, without retaining arbitrary dependency response details. Repeated identical failure logs are suppressed; security still fails closed.
- Client attempts are guarded against overlap, sign-out during session lookup and stale socket callbacks. Close codes appear in connection status; backoff and gameplay remain intact.
- Regression tests cover exact path/production Origin/101, invalid paths, malformed handshakes, diagnostic redaction, authority classification and client cleanup/sign-out/retry behavior.

## Validation

Six existing Chromium tests for Auth, independent-client movement, blur, interruption/reconnect and room lifecycle passed in 1.1 minutes against local SQL/Auth fixtures. An initial new close-diagnostic assertion raced the server's close event; it now waits for that event. Concurrent full-suite/browser execution exceeded existing PGlite initialization timeouts; the final full suite ran with one worker, without changing timeouts or assertions.

- `pnpm typecheck`: passed.
- `pnpm test --maxWorkers=1`: all 217 tests across 21 files passed in 87.81 seconds.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: production web and bundled server builds passed, with the actual public URL supplied as a process-only override; environment files were preserved.
- `pnpm build:local`, then `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/movement.spec.ts tests/browser/rooms.spec.ts tests/browser/auth.spec.ts`: all 6 selected browser tests passed.
- `git diff --check`: passed; final source/test diff reviewed.

## Next deployment and verification steps

1. Review the diff and validation report before approving a commit or deployment.
2. On Render, verify `ALLOWED_ORIGINS` includes exactly `https://neon-grid-tau.vercel.app`, without a trailing slash. Preserve other deliberately authorized production origins; do not add wildcards. Verify `NODE_ENV=production`, `HOST=0.0.0.0` and the provider-assigned `PORT`.
3. Ensure only one server uses the production Supabase project. If local development owns the competing lease, deliberately stop it in a controlled window or use a separate development project. Let the ten-second lease expire; do not delete it or modify grants.
4. After approval, build/redeploy Render with the diagnostics and confirm the intended commit. Preserve existing Supabase credentials and policies. Both `https://neon-grid-server-uske.onrender.com/health` and `/ready` must return 200.
5. Reload the frontend and inspect one handshake. `upgrade_received` proves arrival at Node. Rejection `origin` requires an exact allowlist correction; `not_ready` requires resolving the authority reason. `lease_busy` means another owner; `rpc_permission` means check the intended server credential and existing grants; `rpc_failure` requires private dependency investigation. Inspect existing connections for `capacity`; do not blindly increase the limit. No receipt log outside suppression means inspect ingress/deployed service before changing Auth.
6. Require HTTP 101, then valid authenticated `welcome` and snapshots. Two independent browser profiles must have distinct identities, join one controlled room, move, disconnect/reconnect and agree on state. HTTP 101 alone proves transport, not gameplay authorization.
7. Vercel Production retains `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws` and existing public Supabase settings. Never expose the server key. After approval, rebuild the frontend to publish lifecycle changes. No proxy, Services or bindings are needed; the deployed bundle's URL already matches.

Production acceptance remains pending readiness and authenticated two-client verification. These diagnostics do not claim to repair uninspected provider settings automatically.
