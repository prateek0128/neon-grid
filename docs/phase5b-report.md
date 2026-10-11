# Phase 5B — Moving lasers and progressive difficulty

## Baseline and boundaries

The initial working tree was clean at `bbffc47` (the Phase 5A/readiness commit). The complete initial diff was empty. Existing investigation files and Phase 5A implementation remain preserved. The user reports production Phase 5A acceptance; Phase 5B has not been deployed or verified in production.

No migration, database policy, Auth setting, credential, real environment file, Render/Vercel configuration, production resource, lease operation, commit or deployment was changed. Audio and touch controls remain out of scope.

## Motion and difficulty rules

The existing 30 Hz authoritative match clock drives all timing. One full-width horizontal or full-height vertical beam exists at a time. Opening grace remains six seconds; warnings remain 45 ticks (1.5 seconds). Static opening hazards retain the existing eight-line schedule. The stage indicator changes at the exact thresholds below; a hazard's stage/speed/duration are frozen at its warning start so transitions never truncate an existing warning or activation.

| Stage | Match time | Warning-start spacing | Active duration | Motion |
| --- | --- | --- | --- | --- |
| 1 | Before 30 seconds / tick 900 | 120 ticks / 4 seconds | 30 ticks / 1 second | Existing static lines |
| 2 | From 30 seconds | 120 ticks / 4 seconds | 60 ticks / 2 seconds | 160 px/s, 320-pixel sweep |
| 3 | From 60 seconds / tick 1800 | 105 ticks / 3.5 seconds | 60 ticks / 2 seconds | 200 px/s, 400-pixel sweep |

The first moving warning starts at 30 seconds and activates at 31.5 seconds. The stage-three indicator appears at 60 seconds; the previous stage-two activation finishes normally. The first stage-three warning starts at 62 seconds and activates at 63.5 seconds.

Sweeps alternate horizontal and vertical lines. Direction reverses every pair of hazards, yielding upward, leftward, downward and rightward sweeps. Coordinate starts are 40 pixels from the relevant edge: y=40 or 600 for horizontal beams; x=40 or 920 for vertical beams. End coordinate is start plus signed speed times two seconds. All paths remain at least 40 pixels inside the arena. Warning keeps the beam at its start; active position advances deterministically; no client clock drives it.

Pressure is bounded to one hazard, never overlapping warning/active generations. The fastest beam is slower than ordinary 210 px/s player movement. The advertised corridor retains safe space outside it, and 1.5 seconds of warning allows ordinary movement beyond the nearer side of its maximum 400-pixel corridor. These bounds are intentional fairness constraints, not a substitute for player balancing feedback.

The schedule uses absolute simulation seconds. Configured matches shorter than 30 seconds finish before moving lasers; longer matches plateau at stage three. It does not modify match duration, extraction opening/closing ticks, lockdown ordering or scoring/ranking. Healthy-simulation timing and bounded server catch-up remain unchanged.

## Authority, collision and protection

`laserAtTick` computes schedule, axis, direction, speed, start/end, current and previous coordinates. `advanceHazards` uses that state within the existing server step. Movement still precedes damage; collection and extraction still follow damage, and the existing deadline finalizes once.

Collision measures the relative player-to-beam segment from the previous to current tick. The inclusive hit band is 19 pixels: player radius 14 plus laser half-width 5. Opposite simultaneous motion and Dash cannot tunnel through the beam. The first activation tick has no pre-warning beam sweep. Damage is still 50, and each player receives at most one collision outcome per hazard activation, including shield/invulnerability blocks. Protection expires at the existing exact tick boundary; consuming a block does not allow a later hit from that same activation.

Disconnected, dead and extracted players retain their existing immunity/gating. Respawn selects outside the entire advertised corridor of warning/active sweeps rather than only the beam's instantaneous position, while retaining core/body spacing and protection rules. Expired membership is still pruned by the existing server reconciliation.

Clients cannot nominate hazard coordinates, damage, motion or difficulty. Exact-field client validation and all Auth, session, sequence, rate and room-authorization checks remain unchanged.

## Protocol, presentation and lifecycle

Additive protocol-version-one snapshot fields carry difficulty stage and each hazard's stage, movement endpoints, signed direction, speed and previous coordinate. The parser validates stage thresholds, timing, speed limits, arena bounds, directional endpoints and coordinates against the gameplay tick. Older static snapshot shapes remain accepted. Update the web and server together for Phase 5B; mixed-version operation is not an acceptance claim.

Canvas renders the snapshot beam directly, an amber warning corridor, movement arrow, and red active sweep. The HUD labels sweep warnings/active motion and displays pressure stage. It derives warning time from authoritative ticks, without client outcome timers. Existing responsive canvas/UI remain in place. A browser screenshot of an active upward sweep, corridor, arrow and stage-two HUD was visually reviewed. Vertical beam labels near the right edge are placed to the left of the beam to stay within the canvas; final TypeScript checks and both builds passed after that rendering adjustment.

Reconnect obtains current hazard position/phase/stage without restarting the schedule. Finalized gameplay freezes hazards and difficulty through the existing results pipeline. Replay creates stage one and the original idle opening laser; lobby return destroys the arena. Extraction/lockdown, host authorization and results ranking were extended only through existing snapshot state; their systems were not rebuilt.

## Exact files changed

- `packages/protocol/src/index.ts`
- `packages/simulation/src/hazards.ts`
- `packages/simulation/src/gameplay.ts`
- `packages/simulation/src/moving-hazards.test.ts` (new)
- `apps/server/src/moving-hazard-server.test.ts` (new)
- `apps/web/src/Arena.tsx`
- `apps/web/src/HealthHud.tsx`
- `tests/browser-services.ts`
- `tests/browser/moving-lasers.spec.ts` (new)
- `docs/phase5b-report.md` (new)

The browser fixture adds an optional `NEON_TEST_MATCH_SECONDS` duration override, validated to 10–3600 seconds. This is test-only orchestration: its default stays twenty seconds, existing fixture keys remain dummy values, and no production or real environment setting is modified.

## Validation and corrected failures

- Existing focused hazard/extraction/protocol/socket regressions: 69 tests passed across four files.
- New moving simulation coverage: eleven tests passed, including all four directions, 3601 deterministic clock samples, maximum configured clock, exact warning/difficulty transitions, bounds/speed limits, relative collision tangency, protection/dead/disconnected/extracted gating, one-hit damage, safe respawn, snapshot validation and forged fields.
- Final focused moving-simulation/two-client repeat: all twelve tests passed across two files in 4.07 seconds.
- Two-client real-socket test uses controlled simulation time for identical moving snapshots, reconnect during motion, stage three, extraction opening, lockdown/results, replay stage reset and host lobby return.
- `pnpm typecheck`: passed after correcting the new browser test's root-workspace type import and optional gameplay typing. Earlier compilation also caught a missing numeric narrowing in protocol validation; it was corrected.
- An initial new snapshot test failed because it jumped the fixture clock via `advanceHazards` without updating extraction's remaining-time field. It now advances through the normal gameplay step; the corrected test passed. Runtime validation was not weakened.
- `pnpm build:local`, then `NEON_TEST_MATCH_SECONDS=45 NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/moving-lasers.spec.ts`: the dedicated two-browser sweep/render/reload test passed in 53.7 seconds (test itself 40.2 seconds).
- An attempted browser exclusion flag was unsupported; the standard suite was subsequently launched with the normal command. The moving test intentionally skips in the default short fixture and is executed separately with the documented 45-second override.

- `pnpm test --maxWorkers=1`: all 254 tests passed across 25 files in 102.20 seconds.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: both Vite web and bundled server production builds passed. The public URL was a process-only build override; real environment files were unchanged.
- `git diff --check`: passed; the tracked diff and new test sources were reviewed.

- `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test`: all eleven standard Chromium regressions passed in 3.1 minutes. The moving test intentionally skipped in this short-fixture run; it passed separately with `NEON_TEST_MATCH_SECONDS=45`. Combined executed browser coverage is twelve passing scenarios.

No final validation failures remain. All automated acceptance is local; no Phase 5B production claim follows from it.

## Manual two-browser verification

After explicit approval for a coordinated web/server deployment:

1. Open two independent browser profiles, create/join a room, ready both and start. Confirm distinct identities, matching HP and the existing first warning at six seconds.
2. At 30 seconds, confirm stage two and a full corridor/direction warning in both clients. At 31.5 seconds, observe the upward horizontal sweep from y=600 toward y=280; subsequent beams alternate orientation/direction. Compare hazard positions at matching snapshot ticks rather than unmatched screenshots.
3. Dodge the corridor; test a shield block while the beam crosses. Verify one outcome per activation, health/death/respawn and safe respawn placement. Reload a client during a sweep and verify the shared current schedule recovers.
4. At 60 seconds, confirm the stage-three HUD. The previous sweep keeps its parameters; from the 62-second warning, motion reaches 200 px/s and warnings repeat every 3.5 seconds. There must still be 1.5 seconds warning and only one hazard at a time.
5. During extraction, extract one player. Subsequent moving beams must not damage that player. Compare lockdown, final scores and outcomes; reload results. Host replay must restore stage one, idle laser grace and cleared extraction state. Host lobby return and a later fresh start must remain functional.
6. Repeat with the other player, narrow viewports and deliberate brief disconnects. Check direction arrows, warnings and beam visibility. Do not capture Auth headers, tokens or server credentials.

## Limitations

One arena, one authoritative server replica and memory-only state remain. No new scaling, results persistence, audio or touch controls were added. Hazard rendering follows 15 Hz snapshots without predictive client hazard motion. Difficulty is fixed at 30/60 simulation seconds rather than scaled to configured match length; short matches may never reach escalation. Live production, physical-device and non-Chromium acceptance remain unverified for Phase 5B.

## Final Git state

HEAD remains `bbffc47`. Six tracked files are modified and four files are untracked (the new tests/report listed above). No commit or deployment occurred. Production Phase 5B acceptance remains pending the manual checklist.
