# Production WebSocket 403 follow-up — 12 October 2026

## Evidence and limits

The reported browser message is “Unexpected response code: 403”. No new screenshot attachment is present in this turn; the reported status is treated as user evidence. It establishes rejection of the HTTP upgrade, not the rejection category.

Fresh token-free checks during this investigation returned:

- /health: HTTP 200, status ok, protocol 1.
- /ready: HTTP 503, status not_ready, protocol 1.
- Actual ws-library handshake to /ws with Origin https://neon-grid-tau.vercel.app: HTTP 503, not 403.

The public frontend asset /assets/index-CnqJxti-.js contains the expected secure /ws endpoint and no local ws://localhost:8787 or ws://127.0.0.1:8787 endpoint. Only boolean endpoint checks were printed; no bundle/key/token contents were printed. A bundle filename cannot establish the server deployment commit.

The prior user-supplied Render logs establish lease_busy and originAllowed=true for the earlier 503. Those logs do not establish the cause of the newly reported 403. The exact deployed 403 branch remains unconfirmed without timestamp-matched upgrade_rejected diagnostics and deployed commit. No production configuration correction is justified yet.

## Complete admission trace

The browser configuration validates a secure endpoint, rejects credentials/query/fragment and uses the URL directly. connection.ts:67 constructs one WebSocket per guarded attempt; authentication is sent in onopen at line 73. App.tsx:105 keys the connection by room ID/status/match ID, while room polling at line 96 occurs separately every two seconds. Successful Supabase RPCs prove access to room metadata, not admission to the Render authority.

server.ts:85 selects the first matching admission failure:

| Priority | Condition | HTTP status | Safe diagnostic reason |
| --- | --- | --- | --- |
| 1 | Shutdown has begun | 403 | closing |
| 2 | Raw request path is not exactly /ws | 403 | path |
| 3 | Origin is absent or not an exact configured allowed origin | 403 | origin |
| 4 | 32 connections already exist, including unauthenticated sockets | 403 | capacity |
| 5 | Authority is not ready | 503 | not_ready |
| 6 | Invalid WebSocket handshake | 400 | handshake |

server.ts:93 upgrades accepted connections with 101. Authentication verification and room authorization follow afterwards (server.ts:199 onward). INVALID_SESSION and NOT_MEMBER are WebSocket error messages followed by close code 1008, not HTTP 403. Protocol rejection also occurs after the upgrade. Client response parsing cannot cause a server HTTP handshake 403.

config.ts:25 parses comma-separated origins and validates exact HTTP(S) origin syntax; production requires public HTTPS. No wildcard, substring or path matching is allowed. /ws/, /api/ws or /ws with query parameters are intentionally rejected. Provider-side ingress or an older deployment remains possible if the corresponding application log is absent outside suppression. The current live 503 is consistent with Node's not_ready branch.

The empty board and Linking match clock are consequences of absent authoritative snapshots; room metadata does not create a client-owned simulation clock.

## Confirmed code defect and smallest safe fix

A new real-socket capacity regression reproduced HTTP 403 but could not observe its category: 32 accepted connections generate at least 64 routine diagnostic events, exhausting the previous shared sixty-event connection budget before capacity rejection.

server.ts now gives upgrade_rejected events an independent admission diagnostic budget. Each of admission, connections and readiness remains limited to sixty events per minute plus one suppression marker. The fix logs the existing safe category under ordinary connection-log exhaustion; it changes no admission decision, socket limit, Origin, authentication, lease or gameplay behavior. Raw request URLs, Origins, headers, payloads, user/room identifiers, error text and tokens remain excluded.

This fixes an evidenced observability defect. It does not claim to fix an unconfirmed production 403. Existing rejection logging was reused rather than duplicated or made unbounded.

## Tests

New real-socket regressions:

- Authenticated HTTP ng_get_room returns 200/IN MATCH for a real fixture member, while that member's deliberately unlisted Origin receives handshake 403. Using the fixture's allowed Origin then obtains authenticated welcome. This demonstrates independence of RPC authorization and WebSocket admission; it does not assert production Origin misconfiguration.
- 32 open sockets cause a category=capacity HTTP 403 before token verification, even after routine logs are exhausted; releasing one socket permits a fresh upgrade.
- Invalid session and missing membership produce HTTP 101 followed by their precise WebSocket error/1008 close, never an admission 403.
- Existing diagnostic-exhaustion test now checks independent admission suppression and the sixty-rejection bound while readiness logs remain available.

Existing tests cover exact production Origin/101, missing/forbidden origins, invalid paths, malformed handshake, readiness 503/recovery, redaction, stale callbacks, retry cancellation, sign-out, and gameplay lifecycle/security.

- Initial focused run: 29 passed, one new capacity test failed because the existing shared budget suppressed the expected rejection event. This failure reproduced the diagnostic defect; admission itself correctly returned 403.
- After the bounded-budget fix: focused operations/client run passed 30 tests across two files in 5.83 seconds.
- Final focused run including authenticated HTTP/403 integration: **33 tests passed across three files in 13.64 seconds**.
- Full suite before the final HTTP integration addition: 265 tests passed across 26 files in 98.56 seconds. Final complete-suite rerun: `pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000`: **266 tests passed across 26 files in 82.81 seconds**.
- `pnpm typecheck`: passed, including a repeat after the final integration test.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: both web and server production builds passed with a process-only public URL override. Environment files were unchanged.
- `git diff --check`: passed; full tracked diff and both untracked investigation reports reviewed.
- Browser tests were not rerun for the server-diagnostics/test-only change. Production authenticated multiplayer remains unverified.

## Changed files and preservation

This follow-up changes:

- apps/server/src/server.ts — independent bounded admission diagnostics.
- apps/server/src/operations.test.ts — three new cases and bounded diagnostic assertions.
- apps/server/src/room-server.test.ts — same-member HTTP 200 versus denied upgrade integration test.
- docs/production-websocket-403-investigation.md — this report.

Initial branch main, HEAD da5828e. Existing modifications to operations.test.ts and connection.test.ts and untracked docs/match-clock-investigation.md were read and preserved. connection.test.ts and the match-clock report are unchanged by this follow-up. No reset, discard, commit, deploy, process stop, environment/Auth/policy/migration/provider change occurred.

## Recommended action and verification

1. Obtain timestamp-matched Render upgrade_received/upgrade_rejected lines for the actual 403 and the deployed commit. Safe categories suffice; do not share tokens or raw request payloads.
2. If reason=origin, compare the actual browser origin privately with the exact allowlist. Propose the specific missing origin and request approval before changing the production setting. Do not add wildcards.
3. If reason=path, compare the actual request path with /ws and deployed URL construction before changing code/configuration.
4. If reason=capacity, identify active/reconnecting clients and verify cleanup/auth timeout. Do not blindly increase capacity or weaken authentication. The added diagnostic fix is prepared locally for review; it is not deployed.
5. If reason=closing, correlate the attempt with a controlled restart/deployment. If logs show not_ready/503, follow the separate confirmed lease-contention investigation, identifying the owner before any stop or handoff.
6. If no application receipt/rejection exists, account for diagnostics_limited and inspect ingress/deployed version before calling it a CORS or Auth bug.
7. After an approved, evidenced remedy, require /ready 200, a production-Origin 101 handshake, authenticated welcome plus gameplay snapshots, and two independent clients with distinct identities, populated arena and progressing match clocks.
8. Verify synchronized moving hazards/difficulty, shield/death/respawn, extraction/lockdown/results, reconnect, host replay and lobby return. Never equate token-free 101 with authenticated multiplayer acceptance.

Production recovery and the historical 403 root cause remain unverified. No production setting change is requested without its diagnostic evidence.

## Final working tree

HEAD remains da5828e on main. Four tracked files are modified and two investigation reports are untracked; nothing is staged. The connection test and match-clock report were pre-existing changes and remain preserved. No commit or deployment occurred.
