# Phase 3A — authoritative cores and scoring

Phase 3A adds a playable core-collection loop to the verified Phase 2 rooms/movement foundation. The user reports live Phase 2 acceptance against the dedicated Supabase project. Phase 3A checks below use isolated fixtures and do not establish live Supabase gameplay acceptance. No remote database changes or deployment were performed.

## Rules and implementation

- Existing arena: 960×640 pixels, 24×16 cells of 40 pixels; solid boundary, no interior walls.
- Eight cores occupy distinct cell centers. Spawning excludes cells occupied by any eligible player's current/default spawn position, player-body overlap and other active/inactive core positions. Unconnected members' default positions are reserved too.
- Automatic collection follows authoritative movement in the existing 30 Hz fixed-step loop. An eligible connected player with an open socket and unexpired authenticated session collects within 22 pixels (14-pixel player radius plus 8-pixel core radius).
- Each core becomes inactive before awarding points. Same-tick contenders are ordered by slot then identity; the first wins once. Core iteration order defines event order if multiple pickups occur in one step.
- Base value: 100. First pickup is 1×, second consecutive pickup 2×, third and later 3×. Every successful pickup extends a five-simulation-second window; at its exact deadline combo resets to zero and multiplier to 1×. Combo counts can exceed three; the multiplier cannot. Score remains unchanged on expiry.
- A collected core stays inactive for two simulation seconds, then receives a fresh match-local ID and safe position. A stationary collector cannot immediately harvest its replacement. Spawn waits if no safe cell exists.
- Rules live in shared protocol constants. Pure gameplay functions live in the shared simulation package; only the server invokes scoring for authoritative state. The browser displays snapshots without optimistic rewards.
- Canvas renders gold cores and a short authoritative event ring/+points effect. The existing roster displays every member's score, combo and multiplier, highlighting the local score. A recent collection indicator names the collector.

## Protocol and security

No new client messages or gameplay RPCs exist. Clients still send only authentication and validated movement intent. Exact-key validation rejects collection commands, client score fields, core IDs, multipliers and authoritative positions. Roomless production admission, outsider denial, sequence/rate validation, token renewal and expiration remain intact.

Room-match snapshots extend protocol version 1 with an optional `gameplay` object:

- `tick`: match simulation clock.
- `cores`: `{ id, position, active }`, maximum eight.
- `scores`: `{ id, score, combo, multiplier, comboExpiresAtTick }`, maximum four, keyed by stable room membership ID.
- `events`: `{ sequence, tick, coreId, playerId, position, points, multiplier }`, latest sixteen, ordered by monotonically increasing match-local sequence.

The parser checks array bounds, identities, finite positions, integer score/clock values, multiplier range and ordered event sequences. Internal respawn scheduling is not exposed. Events are display history, never award commands; rereading them cannot change a score. All authorized sockets in the match receive the same snapshot. The explicit development movement arena retains its movement-only payload with no gameplay field. Update the client and server together.

RLS, browser database permissions, the applied migration and secret handling are unchanged. Gameplay is match-scoped server memory; no scores/positions/cores are written by the browser or stored in browser local storage. There is no new endpoint or alternative authentication path.

## Lifecycle and reconnect

Room reconciliation creates gameplay only for server-activated matches and synchronizes eligible membership. Scores are separate from the socket/position map: a reconnect restores current totals and cores without awards, even if the 15-second position grace elapsed and position resets. Membership must remain valid. Disconnected players cannot collect; their combos still expire while healthy match simulation runs. Removed members lose score state on reconciliation.

Return to Lobby, abort, expiry or loss of the active match deletes the arena and gameplay state. A subsequent match has a new epoch and starts with zero scores/new cores. Existing one-second database reconciliation and five-second authority freshness bounds remain; lifecycle/membership changes are enforced on reconciliation. Authority failure pauses gameplay and closes room sockets. Shutdown clears all arenas. Server restart follows Phase 2 lease recovery, aborting the old match rather than recovering in-memory scores. One persistent server replica remains required.

## Local commands

Existing ignored environment files remain in place; no credentials were changed. Browser needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GAME_SERVER_URL`. Server needs the existing URL/public key and server-only `SUPABASE_SERVER_KEY`, plus documented host/port/origin settings. No additional variable or migration is required.

```sh
pnpm dev
# Or, in separate terminals:
pnpm --filter @neon/web dev
pnpm --filter @neon/server dev

pnpm typecheck
pnpm test --maxWorkers=1 --hookTimeout=30000
pnpm build
NEON_TEST_WEB_PORT=5174 pnpm test:browser
```

The alternate browser-test port prevents interference with a running development browser on 5173. Fixture Auth/API and game server use 9100/9101. Browser tests always use test-specific Supabase settings, not the live project.

## Two-browser live checklist

1. Restart/reload both updated development applications. Open `http://127.0.0.1:5173` in a normal window and an isolated private window/profile; do not duplicate a tab with inherited session storage.
2. A creates a room; B joins with a different callsign and the shared code. Confirm distinct identities, correct YOU markers and A's host controls.
3. Both ready; A starts. Both should connect to the same active match and see eight gold cores and zero scores. No gameplay is available in the lobby.
4. Use WASD in A and arrow keys in B. Drive A onto a core. Both should show the same disappearance, collector and score; first pickup awards 100 once. Stay at its old location: its replacement should appear elsewhere after two seconds without granting extra points.
5. Collect consecutive cores within five seconds: awards should be 100, 200, 300, then 300. Wait at least five seconds without a pickup; combo returns to zero/1× without losing points. Collect again for 100.
6. Have both approach the same core. Only one receives its reward; an exact same-tick tie favors the lower slot. Then collect separately with B and compare both scoreboards.
7. Reload B or briefly interrupt its socket. Verify the same member ID, current score/core state and no duplicate reward. Longer disconnects can reset position after 15 seconds; membership heartbeat expiration still applies.
8. A returns to lobby. Both lose the active canvas/score display and reset readiness. Start again and confirm zero scores/new core state.
9. Exercise leaving/host transfer, outsider admission denial and reconnect. A server restart should abort the run after lease recovery, never silently restore or carry forward old scores.

Do not share request headers, tokens or server credentials during verification.

## Known limitations and next phase

Scores and events are active-match memory only, not durable results. There is one arena and one server replica; no touch controls, prediction or physical-device/non-Chromium verification. Same-tick ties favor lower slots. Spawn distribution is random without a fairness-balancing algorithm. Combo/respawn time uses simulation ticks and follows the existing bounded catch-up behavior on process stalls. The event log is bounded and not an audit history.

The new two-context browser test disables trace recording because the local Playwright artifact transport truncated its archive during context close; gameplay assertions and screenshot capture remain enabled, and existing regression tests retain their trace setting.

Phase 3B is not implemented. Recommended next planning step is to define server-authoritative laser hazards and damage/health rules, their snapshot/event contracts, collision tests and UI feedback. Dash, shield, extraction and results need their own approved scope.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Passed | Entire workspace, tests and configs |
| Automated suite | 80 passed across 9 files | Existing Auth/rooms/RLS/movement regressions plus deterministic spawn, one-time rewards, simultaneous ties, combos, respawn, bounded events, protocol manipulation and server lifecycle |
| Extended server reconnect check | 4 passed | Gameplay integration rerun after strengthening reconnect to exceed the 15-second position grace |
| Browser suite | 7 passed | All existing regressions plus isolated two-session collection, common scores, reconnect and fresh match reset |
| Browser/server production builds | Passed | Vite build and bundled persistent server |
| Visual inspection | Passed | Captured collection interface inspected |
| Live Phase 3A Supabase gameplay | Not performed | Requires the two-browser dedicated-project checklist above |

The initial browser run completed gameplay assertions but failed during trace archive transport on context close. Disabling tracing for that test resolved the tooling failure; the complete seven-test suite then passed. No fixture result is reported as live acceptance.

## Files changed

```text
README.md
apps/server/src/server.ts
apps/server/src/gameplay-server.test.ts
apps/web/src/App.tsx
apps/web/src/Arena.tsx
apps/web/src/style.css
packages/protocol/src/index.ts
packages/protocol/src/protocol.test.ts
packages/simulation/src/index.ts
packages/simulation/src/gameplay.ts
packages/simulation/src/gameplay.test.ts
playwright.config.ts
tests/browser-services.ts
tests/browser/gameplay.spec.ts
docs/architecture.md
docs/phase2-report.md
docs/phase2-database.md
docs/phase3a-report.md
```

The previously tested authentication fix was committed separately as `d2ba9c5`. Existing user-created `supabase/config.toml` and `supabase/.gitignore` are left untouched and outside the Phase 3A commit. Dependency manifests and lockfile are unchanged.
