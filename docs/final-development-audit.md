# Final development audit

## Scope and preserved baseline

Audit date: 2026-10-12. Started on `main` at `da5828e`, with 34 modified tracked files, 12 untracked files and nothing staged. Those files include the existing HTTP migration and investigation reports. All pre-existing work and earlier reports were preserved. No commits, deployments, user-process stops, provider changes, real environment-file edits, migrations, authentication changes or RLS changes were made.

Reviewed the HTTP migration report, Phase 3A–3D and 5A–5C reports, README/scripts, protocol, simulation, server transport/lifecycle, room/auth client, rendering/controls and regression coverage. The migration's 287 automated tests and twelve browser scenarios are historical evidence, not results of this audit. Current validation is recorded separately below.

## Completion checklist

| Area | Current status and evidence |
| --- | --- |
| First-time experience and room entry | Anonymous identity, callsign, private-room create/join, loading and visible errors already implemented in `App.tsx`, `auth.ts` and `room-client.ts`. Added concise objective, scoring and desktop-control instructions. |
| Lobby/readiness/start | Roster, ready states, host-only start, minimum two players and SQL-enforced room authorization implemented; room/server/SQL tests retained. No duplicate lobby system added. |
| Movement/Dash/Shield | Authoritative normalized WASD/arrows, ability intent validation, cooldowns, shield and feedback implemented. Fixed native Space-button activation and key release after focus changes; made arena focusable. |
| Cores/combo/HUD | Existing eight-core simulation, pickup validation, score/combo tracking, scoreboard and collection feedback retained. Gameplay tests cover synchronization and forged fields. |
| Lasers/damage/respawn | Static warnings, four moving sweep patterns, bounded staged difficulty, shield/invulnerability, death/respawn and extracted-player immunity implemented. Existing simulation and hazard tests retained. |
| Timer/extraction/lockdown | Server tick/deadline, default 90-second match, extraction window and lockdown implemented in shared simulation/server/UI. No timer or balance changes. |
| Results/ties/replay/lobby | Authoritative ranking/ties, host replay and lobby return already implemented. Fixed keyboard activation of lifecycle buttons and displayed recovery status on results as well as active matches. |
| HTTP synchronization/recovery | Authenticated HTTP actions/polling, bounded retries, deduplication, reload resume, token renewal and room fallback implemented. Fixed unseen stale actions closing valid sessions and client retrying a stale body indefinitely. No WebSockets or Realtime introduced. |
| Responsive/accessibility/loading | Phase 5C readable warnings and responsive layout retained. Added visible button/arena focus, preserved native Space behavior and announced connection detail. Narrow-screen browser flow verifies no horizontal overflow. Desktop keyboard remains required; Canvas is not a fully nonvisual game interface. |
| Security/concurrency/reliability | Strict Origin, identity, membership, session, sequence, payload/rate limits and singleton authority fence retained. Existing security, SQL, HTTP and restart tests cover these boundaries. Native concurrent Postgres and live production remain separate verification gates. |

## Prioritized work completed

1. Preserve valid authoritative sessions when an unseen older HTTP input arrives after a newer accepted input. Return recoverable `409 STALE_SEQUENCE`, without dispatching old intent or closing the session.
2. On that rejection, resume the session and synchronize its sequence before sending fresh intent. Retain identical accepted-action retry behavior and conflict checks.
3. Let Space activate focused native buttons instead of intercepting it as Dash. Always release held movement/ability keys even when focus changes before keyup.
4. Show recovery detail at results, make network interruption wording actionable, expose visible keyboard focus and clarify the first-time objective/controls.

These were the smallest useful changes found. Completed movement, hazards, scoring, extraction and lifecycle systems were not rebuilt.

## Confirmed bugs and fixes

### Late HTTP input corrupted connection continuity

In `apps/server/src/server.ts`, `/game/step` dispatched an unseen older sequence into the original strict input handler. That handler rejected `STALE_SEQUENCE` by closing the logical peer. A targeted reproduction accepted sequence 2, sent unseen sequence 1, then polled: the poll returned **401** instead of **200**. Rejection should protect the newer authoritative intent without destroying its valid session.

The HTTP layer now checks unseen stale sequences before dispatch. Its regression asserts 409, continued authenticated polling, unchanged last sequence and movement in the newer direction. Accepted duplicates still use the bounded action cache; conflicting encodings remain rejected.

In `apps/web/src/connection.ts`, only `SEQUENCE_CONFLICT` triggered resume, leaving `STALE_SEQUENCE` to retry the same pending body. Its regression reproduces that retry path and now verifies `/game/resume`. Resume remains authenticated and returns current authoritative state/sequence; the client supplies no position or outcome.

### Global shortcuts intercepted native controls and held keys

In `apps/web/src/keyboard.ts`, Space always prevented default while gameplay controls were attached, including when Play Again, Return to Lobby or Shield had focus. Keyup also returned early for editable targets, leaving a held movement key active after focus changed. Both failed before the fix. The new focused tests protect native button behavior and unconditional key release; the browser scenario verifies real Space activation for Shield/replay/lobby and Dash with arena focus.

### Results hid recovery feedback

In `apps/web/src/App.tsx`, connection detail belonged only to the non-results branch. A disconnected results view disabled lifecycle actions without displaying its reason. Detail now spans both branches with `role="status"`. Network failures show “Connection interrupted. Retrying…” rather than raw fetch wording. No credentials, headers or payloads are logged.

## Exact files changed by this audit

This list describes additions to the existing working tree, not the entire uncommitted HTTP migration.

- `apps/server/src/server.ts`: nonterminal stale HTTP input rejection.
- `apps/server/src/http-server.test.ts`: late-input/session continuity regression (pre-existing untracked file extended).
- `apps/web/src/connection.ts`: stale-sequence resume and readable interruption feedback.
- `apps/web/src/http-connection.test.ts`: stale-response resume regression (pre-existing untracked file extended).
- `apps/web/src/keyboard.ts`: native Space behavior and focus-independent key release.
- `apps/web/src/keyboard-focus.test.ts`: new focused keyboard regressions.
- `apps/web/src/Arena.tsx`: keyboard-focusable arena.
- `apps/web/src/style.css`: visible keyboard focus.
- `apps/web/src/App.tsx`: objective/controls and recovery detail across match/results.
- `tests/browser/final-flow.spec.ts`: new two-context, narrow-screen, keyboard/results recovery/replay/lobby scenario, with WebSocket construction blocked.
- `README.md`: correct stale extraction and transport descriptions.
- `docs/final-development-audit.md`: this report.

## Validation

Initial focused reproductions: **four failures, thirteen passes** across three files. An isolated stale-input reproduction also failed as expected (one failed, six not selected). These are diagnosis results, not final passing coverage.

After fixes:

- Focused regression suite: **18 tests passed across four files**, 5.90 seconds.
- TypeScript: passed after implementation and browser scenario creation.
- Local browser-fixture build: both builds passed.
- Affected browser scenarios: **five passed**, 2.0 minutes, no skips. Includes two independent contexts, Shield/Dash and reload, keyboard/reconnect movement, results reload/replay/lobby, and the new narrow-screen keyboard/offline-results flow. WebSocket construction was blocked. Reviewed the generated 375-pixel results screenshot: recovery status and lifecycle buttons are readable; the existing rankings table scrolls horizontally within its container.
- Both final production builds: passed with the process-only public HTTPS URL override. TypeScript passed again immediately before these builds.
- Full automated suite: **291 tests passed across 31 files**, 138.87 seconds, no failures or skips. This includes HTTP/authorization/restart tests plus preserved historical transport and gameplay regressions; it is not a claim that all tests use the active HTTP transport.
- Final diff review and `git diff --check`: passed. Reviewed the new audit changes together with the preserved migration diff; active client/server transport sources have no socket construction/upgrade or Realtime subscriptions. Historical test-only references remain as documented in the migration report. Earlier phase reports have no diff.

Commands used (Node 24/pnpm 11):

```sh
pnpm exec vitest run apps/server/src/http-server.test.ts apps/web/src/http-connection.test.ts apps/web/src/keyboard-focus.test.ts apps/web/src/keyboard.test.ts --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
pnpm typecheck
pnpm build:local
NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/final-flow.spec.ts tests/browser/abilities.spec.ts tests/browser/results.spec.ts tests/browser/movement.spec.ts
pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
VITE_GAME_SERVER_URL=https://neon-grid-server-uske.onrender.com/ pnpm build
git diff --check
```

The production-build URL is a process-only public URL override; no environment file or provider setting is changed. Browser tests use isolated Auth/SQL fixtures and the actual bundled HTTP server, not live Supabase. Unit tests run separately from browser fixtures to avoid unnecessary PGlite resource contention. No skipped or unexecuted scenario counts as a pass.

Final Git state: `main` remains at `da5828e`; **37 modified tracked files, 15 untracked files, nothing staged**. Compared with the initial baseline, three previously clean tracked files are modified (`Arena.tsx`, `keyboard.ts`, `style.css`) and three new files were added (`keyboard-focus.test.ts`, `final-flow.spec.ts`, this report). Other audit edits extend already-modified or already-untracked files. The migration and both investigation reports remain preserved. Generated browser screenshots/build output are ignored artifacts.

## Remaining limitations and release checks

- One database-fenced persistent authority is required. Competing owners fail closed; this audit does not identify or stop production lease owners. Restarts may reset in-memory matches to the lobby; scores/results are not durable across restart.
- Existing 250 ms movement safety timeout is unchanged. High latency can reduce movement continuity; no optimistic outcome or balance workaround was added.
- No touch controls, audio, new mode/infrastructure or extra arena was added. Narrow-layout validation does not imply phone touch play. Physical-device, non-Chromium and fully nonvisual gameplay acceptance remain unverified.
- PGlite validates SQL/RLS behavior but serializes execution. Native multi-connection Postgres contention remains an explicit manual gate.
- No production recovery or live gameplay is claimed from these local tests. Earlier phase production observations do not validate this uncommitted HTTP revision.

After reviewing the diff, the user should coordinate release of compatible server/frontend builds and verify:

1. Exactly one approved authority; `/health` and `/ready` both 200. Handle any lease handoff separately, allowing natural expiry without deleting/replacing the lease.
2. Two independent browser profiles create/join, ready/start and receive distinct IDs, matching snapshots and advancing authoritative clocks via `/game/connect`, `/game/step` and `/game/resume`. Network shows HTTP gameplay and no gameplay WebSocket/Realtime connection.
3. WASD/arrows, normalized diagonals, release/blur stop, Space Dash with arena focus; Tab to Shield and Space activates only Shield. Compare both clients' positions and ability state.
4. Play a default 90-second match: cores/combo, warnings/four sweeps/stages, shield/damage/death/respawn, extraction immunity, lockdown and matching ranked/tied results.
5. Reload during an ability; briefly interrupt networking during movement and at results. Confirm identity/state recovery, visible retry detail, disabled offline lifecycle actions and no duplicated ability/replay. Native Space activates host Play Again and Return to Lobby; the other client follows the generation/lobby transition.
6. During separately approved maintenance, verify restart recovery resets the old room safely. Do not describe this as seamless or durable recovery.

The scoped desktop multiplayer loop is already implemented. These fixes address confirmed continuity/usability defects rather than introduce another feature phase. Local validation and the production/manual gates above determine release readiness; no additional game-system implementation is recommended without a new confirmed issue.
