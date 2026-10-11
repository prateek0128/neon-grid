# Phase 3D — Match lifecycle and finalized results

## Architecture decision before implementation

The existing database room lifecycle is `LOBBY → STARTING → IN_MATCH → LOBBY`. Authenticated RPC requests are validated by the database; the leased game server validates the start roster and owns each in-memory arena. The room UUID and database match UUID fence membership and server ownership. Phase 3C has no automatic completion; only the secured host return-to-lobby RPC ends the run.

Phase 3D keeps that lifecycle and adds `ACTIVE → RESULTS` inside each in-memory gameplay generation. The database room remains `IN_MATCH` during results, allowing the existing membership, host transfer, heartbeat, authorization and return workflow to continue. The server alone finishes gameplay. The current host may request `RESULTS → ACTIVE` replay over the authenticated socket; it generates a fresh match generation and resets gameplay while preserving room/player identities. Existing host return-to-lobby remains available. No countdown or new database state is needed.


## Final lifecycle and end condition

- Database `LOBBY`: members may join/leave and ready up; only the host can request start.
- Database `STARTING`: the existing leased server checks the frozen roster, readiness and start request before entering `IN_MATCH`; changes abort to lobby.
- Database `IN_MATCH`, runtime `ACTIVE`: movement, cores, abilities, hazards, health and respawn advance on the existing 30 Hz authoritative match clock.
- Database `IN_MATCH`, runtime `RESULTS`: the configured deadline finalizes once. Gameplay clock, movement, health, hazard/respawn timers, collection, combo and ability state freeze. Verified sockets still heartbeat membership, and room authorization/cleanup continues.
- `RESULTS → ACTIVE`: current host requests replay with the current runtime generation. At least two current members must have authenticated open sockets. A fresh generation resets gameplay and sockets reconnect with fresh session IDs.
- `ACTIVE` or `RESULTS → LOBBY`: current host requests return with the current runtime generation. The game server invokes the existing `ng_return_lobby` RPC using that host's authenticated token and freshly read room revision. Readiness clears and the arena is discarded.
- Host leave/stale-member cleanup uses existing deterministic database host transfer. Remaining host can return with one player; replay with fewer than two connected players visibly reports that another connection is required. Empty/expired rooms are deleted by existing maintenance. Server replacement retains the existing lease behavior and aborts old database matches to lobby.

The default duration is **90 simulation seconds / 2700 ticks**, shared in `MATCH_RULES`. `MATCH_DURATION_SECONDS` on the game server accepts integer seconds **10–3600**; restart to apply. Browser fixtures use 20 seconds. Direct server/simulation test configuration supports short tick durations without waiting in real time. Trusted room availability governs advancement; a stalled/unhealthy server may extend wall-clock duration. The client never supplies elapsed time or decides completion.

The final deadline step processes authoritative movement, hazard outcomes, then eligible collection in existing stable slot order; that step's points count. Completion then freezes the state before any subsequent step or packet can affect it. No separate per-match timeout callbacks exist. A single `match_complete` event is sent to currently connected members at completion; snapshots retain the final record for recovery. Reconnect receives results without emitting another completion event.

## Results and ranking

The server tracks cumulative points and **cores collected** in a per-generation participant ledger, separate from the bounded feedback-event history. Departing/disconnected players remain in the final ledger; departed names display their original slot label when no longer present in the room roster. No invented kill, extraction or damage statistics appear.

Ranks sort by descending score, then stable slot and ID for display order. Equal scores share competition rank (for example 1, 2, 2, 4). All rank-one IDs are winners; one leader produces `winner`, multiple leaders `tie`, and an empty ledger `empty` with no winner. Zero-score participants can tie. Display ordering does not create a unique winner from a tie. Final scores, rankings, core totals and duration come from the finalized snapshot; the client only formats names, summaries and seconds. Snapshot copies cannot mutate server results.

The responsive results screen uses the existing dark teal/purple design, final rankings table, winner/tie headline, duration/core summary and host controls. The roster shows final scores instead of frozen health/respawn countdowns. Active matches show remaining simulation seconds.

## Replay, reset and stale work

The database match UUID remains the room authorization/lease envelope. The initial runtime generation equals that UUID for compatibility; every replay generates a fresh UUID that appears in the snapshot/welcome epoch and match state. Lifecycle intent must name that runtime generation. Authentication still supplies the database match UUID, since the room authorization envelope is unchanged.

Replay creates a fresh `GameplayState`: zero tick, fresh participant ledger, zero scores/combos/deadlines, new core placement/IDs/active state, zero event counters/history, fresh idle laser schedule/hit ledger, full-health alive vitals, zero respawn/protection deadlines, zero Dash/Shield activity/cooldowns/direction and null results. All authoritative positions reset to slot spawn; movement and recent direction clear. Room/member/player IDs remain stable.

Replay closes old sockets with a restart close code and automatic reconnect restores the new generation. New sockets get new session IDs and input sequences. Old-session packets fail identity validation; old-generation lifecycle actions are rejected. An arena-wide in-flight lock prevents simultaneous replay/return actions, and authorization is rechecked after asynchronous work before reset. A delayed authorization result cannot revive a removed arena. A closed-match fence also prevents an older in-flight room synchronization response from recreating an arena after successful lobby return; it clears after fresh maintenance confirms the database match is absent.

Duplicate/stale sequences retain the existing terminal rejection. Valid but unavailable lifecycle intent produces a visible nonterminal reason: host-only, invalid transition, stale generation, insufficient connected roster, busy or room unavailable. Client pending controls also suppress repeated clicks. Return from a room that is still `STARTING` retains the existing revision-checked room RPC path.

## Reconnect and security

Lobby restore continues through authenticated room polling. Active reconnect recovers current match clock, scores, cores, abilities, health, life state and hazards. Results reconnect recovers the same final generation/rankings and current host controls; it neither restarts gameplay nor recalculates results. Return/replay availability reflects the latest room host from polling, while server authorization is decisive.

No migration, grant, RLS, database state name or auth flow changed. Existing authenticated-only room RPCs and service-only runtime maintenance remain. WebSocket lifecycle intent requires valid session identity, increasing sequence, rate limits, exact fields, current membership and a fresh host check using `ng_get_room`. Host tokens are retained only in connection memory to call the existing user-scoped RPCs, cleared on close, and never logged. Privileged credentials remain server-only. Clients cannot submit end time, final scores, rankings, health, lifecycle phase or completion results. Existing room-level RPC return remains an authorized host operation guarded by database revision; generation fencing applies to the new socket lifecycle path used by the match UI.

## Files changed

- `packages/protocol/src/index.ts`, `protocol.test.ts`: match/result types, configurable default, exact lifecycle intent, rejections/completion and clock/ranking validation.
- `packages/simulation/src/gameplay.ts`, `abilities.ts`, `hazards.ts`, `match.test.ts`: participant statistics, deterministic completion/ranks, immutable snapshot copies and finalized-state gating.
- `apps/server/src/server.ts`, `rooms.ts`, `index.ts`, `lifecycle-server.test.ts`: authoritative lifecycle requests, current-host authorization, replay/session fencing, return via existing RPC, stale-sync fence and duration configuration.
- `apps/server/.env.example`: placeholder-free nonsecret duration setting; real environment files untouched.
- `apps/web/src/Results.tsx`, `App.tsx`, `AbilityHud.tsx`, `connection.ts`, `style.css`: final results, clock, host controls, pending/error feedback, gameplay intent stop and reconnect handling.
- `tests/browser-services.ts`, `tests/browser/results.spec.ts`: 20-second fixture matches and two independent browser contexts testing score/rank agreement, results reload, replay reset, ties and lobby recovery.
- `README.md`, `docs/phase3d-report.md`: current gameplay and lifecycle documentation.

Unrelated untracked `supabase/.gitignore` and `supabase/config.toml` are preserved and excluded from the commit. No new dependency, lockfile change, secret or real `.env` change is included.

## Validation

- `pnpm typecheck`: passed on the final implementation.
- `pnpm build`: web and server production builds passed on the final implementation.
- `pnpm test --maxWorkers=1 --hookTimeout=30000`: **141 passed in 15 files** on the final implementation.
- `NEON_TEST_WEB_PORT=5174 pnpm test:browser`: initial full run **10 passed**. Final all-browser repeat using `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test`: **10 passed** after the final results presentation and scored-winner test updates. Two isolated browser contexts verified identical scored results, active/results/lobby reload recovery, replay reset, a subsequent tie and lobby return against local Auth/SQL fixtures and the built game server.
- Results screenshot visually inspected: winner, authoritative scores/core counts, final-score roster and host controls are readable without frozen respawn countdowns.
- `git diff --check`: passed. Final diff reviewed; no migration, real environment or unrelated Supabase configuration changes are included.

Coverage includes valid/invalid transitions, final-step scores, deterministic ties/lower-place ranks, empty/disconnected/departed participants, cumulative statistics beyond event history, completion once, frozen late gameplay, new generation/reset, replay concurrency, current-host transfer checks, host-only replay/return, insufficient connected players, stale sessions/generations, delayed authorization and stale room-sync fencing. Existing SQL security/host-transfer/empty-room cleanup and Phase 1–3C tests remain intact.

## Manual live verification

1. Run `pnpm dev` with the existing local browser/server environment. Default browser: `http://127.0.0.1:5173`; game socket: `ws://127.0.0.1:8787/ws`. Optionally set server-only `MATCH_DURATION_SECONDS=20` and restart to shorten verification.
2. Use a regular browser profile and an incognito window or a separate profile. Create/join one room, ready both, and start as host. Confirm distinct player IDs and an advancing countdown in both windows.
3. Collect at least one core with Cipher; compare score updates in both views. Reload Ghost during active play and check identity, remaining time, health and hazards recover without reset.
4. Wait for completion. Both should show the same generation, ranked scores, core totals, duration and winner. Gameplay inputs must leave the finalized record unchanged. Reload each at results and compare again. Only current host sees Play Again/Return to Lobby.
5. Play Again once. Both reconnect automatically with stable player IDs, full health, zero points/combos/cooldowns, initial cores/laser schedule and a fresh countdown. Old results disappear. Allow a zero-score replay to finish and verify a shared victory with rank-one players.
6. Return to Lobby. Both regain lobby/readiness controls and a later start creates fresh state. Reload in lobby to check recovery. Test host departure: remaining member becomes host, can return, and can start/replay once at least two participants satisfy the relevant readiness/connection rules.

Live Supabase project multiplayer, physical devices and production deployment have not been tested during Phase 3D. Browser checks use local fixture Auth and the existing SQL room RPCs with the actual built WebSocket server. Passing them is not a live-project verification claim.

## Remaining limits

One persistent server replica; active state/results are memory-only and lost on server replacement. Database rooms deliberately stay `IN_MATCH` during results and runtime replay; the runtime generation carries the gameplay lifecycle. No results history, new join during results, countdown stage, extraction objective, audio overhaul, additional arenas, production deployment or next phase is included. Members lost after the existing 30-second membership grace cannot rejoin that in-progress envelope; the host can return to lobby to admit them. Match duration represents healthy simulation time, not guaranteed wall-clock time. Mobile layout inherits the responsive UI; touch movement and non-Chromium/physical-device checks remain outside executed validation.
