# Production match-clock investigation — 12 October 2026

## Confirmed root cause

Render is unable to acquire the singleton game-server lease. User-supplied current Render diagnostics explicitly show:

```text
{"event":"upgrade_received","path":"ws","originAllowed":true}
{"event":"upgrade_rejected","reason":"not_ready","status":503}
{"event":"readiness","condition":"authority_unhealthy","syncInFlight":true,"authorityFailure":"lease_busy"}
```

Independent token-free live probes returned /health HTTP 200, /ready HTTP 503 with status not_ready/protocol 1, and a real Node WebSocket handshake to /ws with the production Origin returned HTTP 503. No authentication, room mutation or gameplay action was performed by these probes. A preliminary curl upgrade used HTTP/2 and returned 404; it was not treated as a WebSocket handshake result. The actual ws-library HTTP/1.1 probe confirmed 503.

The existing migration (supabase/migrations/20261010000100_secure_rooms.sql:264) returns SERVER_BUSY only when a different owner holds an unexpired lease. apps/server/src/rooms.ts:31 maps that response to lease_busy. server.ts:160 records the failed reconciliation, and server.ts:91 rejects upgrades before authentication. The provided logs establish the deployed rejection branch; the deployed commit hash remains unprovided.

This is a readiness/ownership failure, not evidence of a browser match-clock arithmetic bug, snapshot protocol mismatch, or failed anonymous signup. No welcome or initial snapshot can arrive through the rejected connection. IN MATCH room metadata and successful ng_get_room calls are separate from server authority and can remain visible while another owner maintains the room.

## Client trace

App.tsx:96 polls room metadata every two seconds. Its connection effect (App.tsx:105) depends on room ID/status/database match ID; ordinary unchanged polling does not recreate sockets.

connection.ts:73 sends authentication only after a successful upgrade. connection.ts:81 handles welcome; line 89 installs snapshots and ignores older ticks in the same epoch. Malformed responses become a terminal visible error at line 80, unlike the observed recurring reconnects. Close handling at line 112 retries with bounded exponential delay. App.tsx:172 derives the clock exclusively from an authoritative gameplay snapshot; without one it displays Linking match clock. Room polling never supplies gameplay ticks or positions.

The inspected implementation sends welcome followed immediately by broadcast after membership validation (server.ts:256), and reconnect retrieves current authoritative state. No changes to these authority rules are warranted by the observed pre-upgrade rejection.

## Competing owner and smallest safe fix

Read-only local inspection identified Node PID 60825 listening on 127.0.0.1:8787, with working directory apps/server in this repository. Its /ready returns 200. Its credentials/environment were not read. The exact Supabase project and runtime lease-owner identity were not established, so this is a candidate competitor, not a proven owner.

Safest remedy: identify the unwanted renewing process for the production project, stop it gracefully in a controlled window, and allow natural lease expiry (ten seconds plus the next one-second reconciliation; an already in-flight renewal may extend the wait). Keep one authoritative production instance. A stale row alone cannot block indefinitely; sustained lease_busy indicates an unexpired competing lease at each failed attempt.

Do not delete/overwrite the lease, bypass readiness, loosen grants/RLS, change the frontend URL, or blindly restart Render. Lease takeover intentionally aborts old in-memory matches and returns them to lobby (migration line 301); create a fresh match afterwards. No application-logic fix is necessary for the reproduced fail-closed behavior.

Confirmation/approval was requested before stopping the candidate local process. No process has been stopped by this investigation.

## Changes

- apps/server/src/operations.test.ts: regression for production-Origin 503 during lease contention, no authentication/membership lookup before admission, recovery to readiness and authenticated welcome/initial gameplay snapshot, with token-free diagnostics.
- apps/web/src/connection.test.ts: regression for unsynchronized state on pre-welcome close, retry, welcome/snapshot recovery, stable connection and cleanup.
- docs/match-clock-investigation.md: this evidence and recovery runbook.

Initial tree was clean on main at da5828e (Phase 5C changes were already committed by the user). No existing work was discarded or overwritten. No production code, migration, Auth, environment file, policy or deployment configuration changed.

## Validation

- `pnpm typecheck`: passed, including a repeat after the final client snapshot assertion.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: web and server production builds passed, using a process-only public URL override. No environment file changed.
- Initial focused readiness/client tests: 26 passed across two files (before the additional client regression).
- The first full run passed 261 tests and failed the new recovery test because its default one-second wait raced the one-second reconciliation interval. The new test now allows three seconds for recovery; production code/timing was not changed.
- Final `pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000`: **262 passed across 26 files in 106.22 seconds**, including gameplay, protocol/security, lease expiry, moving hazards and lifecycle coverage.
- Final focused repeat with the complete gameplay-clock assertion: **27 tests passed across two files in 4.90 seconds**.
- `git diff --check`: passed; complete changes reviewed.
- No browser suite was rerun for these test/documentation-only changes. Authenticated live multiplayer remains unverified; the production handshake probe received 503.

## Production verification

1. Confirm the competing instance's production project and deliberately stop the unwanted owner, without lease mutation. If the local process is not the owner, investigate another local/remote replica or old deployment.
2. Look for authority_recovered and readiness condition=ready; require /ready HTTP 200 repeatedly. Inspect continued lease_busy instead of assuming expiry repaired it.
3. Require a production-Origin /ws handshake HTTP 101, then authenticated welcome and gameplay snapshots. A token-free 101 alone is not authenticated gameplay proof.
4. After expected takeover/lobby reset, use two independent browser profiles, ready and start a new match. Confirm distinct players, populated board, matching authoritative snapshot ticks and countdown progression.
5. Verify moving hazards at 30/60 seconds, shield/respawn protection, extracted-player immunity, disconnect/reconnect, extraction/lockdown/results, host replay and lobby return.
6. Do not capture tokens, Auth headers, credentials or sensitive user payloads.

Production recovery and authenticated two-client verification have not been claimed.

## Final working tree

Main remains at da5828e. Two tracked test files are modified, one investigation report is untracked, and nothing is staged. The existing Phase 5C commit and all prior work are intact. No commit, deployment, process stop or production-resource mutation was performed.
