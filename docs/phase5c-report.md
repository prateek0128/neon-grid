# Phase 5C — Arena variety and hazard readability

## Baseline and scope

Inspection found a clean working tree on main at f692eb7, with Phase 5B committed. No existing Phase 5C implementation/specification was found. Phase 5A/B reports, production investigation documents, authoritative simulation, server tick order, protocol validation, rendering and lifecycle tests were reviewed. Existing investigation work remains preserved.

Phase 5B already supplies four deterministic directions. Phase 5C reuses these physical paths, gives them explicit server-issued pattern identities, and makes warning, damaging and completed states easier to distinguish. No new map, overlapping hazard, random path, balance adjustment or gameplay system was added.

## Patterns and preserved rules

| Pattern | First warning | First activation | Stage-two path |
| --- | --- | --- | --- |
| horizontal-up | 30s | 31.5s | y=600 → 280 |
| vertical-left | 34s | 35.5s | x=920 → 600 |
| horizontal-down | 38s | 39.5s | y=40 → 360 |
| vertical-right | 42s | 43.5s | x=40 → 360 |

The existing cycle selects orientation and direction deterministically. Each pattern name is derived on the server from the selected axis/direction and serialized with the hazard. Clients display received names, positions, endpoints and phases; they do not choose patterns or advance hazard clocks. The optional additive version-one field permits existing snapshots without names. The snapshot parser rejects unknown names, names inconsistent with axis/direction, and pattern names on static hazards. Client input cannot contain a pattern or any other hazard/damage/difficulty field.

All original timings remain: 30 Hz simulation; six-second opening grace; 1.5-second warnings; one hazard at a time; 160 px/s and four-second warning-start spacing from 30 seconds; 200 px/s and 3.5-second spacing from 60 seconds. Parameters remain frozen at warning start, so the first stage-three warning still starts at 62 seconds. Active sweeps last two seconds; endpoints remain inside the arena with a 40-pixel margin. Default matches remain 90 seconds with existing extraction timing.

Collision and damage are unchanged: relative swept collision, inclusive 19-pixel player/beam collision band, 50 damage, one outcome per activation, existing shield/respawn protection and dead/disconnected/extracted gating. Server movement/damage/collection/extraction/finalization ordering is unchanged.

## Readability

Warnings use an amber translucent corridor with a dashed outline, direction arrow and dashed starting beam. Active beams use a red outer band and a thin white core; their corridor/arrow change to red/pink. The outer beam remains ten pixels wide. Completed hazards disappear from the canvas and receive explicit “beam off” feedback. Pending initial hazards retain scanning feedback.

The HUD names each sweep, displays its arrow/direction and a fractional countdown calculated only from the received snapshot tick. Text and border styles distinguish warning, active damage and completion without relying solely on color. A wrapping legend explains the shapes. Static warnings describe their dashed line rather than falsely suggesting a moving corridor.

## Exact changed files

- packages/protocol/src/index.ts — pattern type and snapshot consistency validation.
- packages/simulation/src/hazards.ts — authoritative names for the existing deterministic paths.
- packages/simulation/src/moving-hazards.test.ts — four-pattern collision/shield/transition checks and forged/legacy protocol checks.
- apps/server/src/moving-hazard-server.test.ts — explicit authoritative identity assertion in two-client/reconnect/lifecycle coverage.
- apps/web/src/hazard-presentation.ts — snapshot-driven labels and phase feedback.
- apps/web/src/hazard-presentation.test.ts — pending/warning/active/completed/static/legacy presentation checks.
- apps/web/src/HealthHud.tsx — pattern/phase feedback and legend.
- apps/web/src/Arena.tsx — corridor outlines, state colors and high-contrast active beam.
- apps/web/src/style.css — distinct status treatments and wrapping legend.
- tests/browser/moving-lasers.spec.ts — names, completion, reload, identical two-client state and narrow viewport checks.
- docs/phase5c-report.md — this report.

## Validation

- `pnpm typecheck`: passed, including a final repeat after test edits.
- `pnpm exec vitest run packages/simulation/src/moving-hazards.test.ts apps/web/src/hazard-presentation.test.ts`: 17 tests passed across two files.
- The first full-suite run overlapped the browser fixture run and ended with timeout failures in room-server setup, moving-hazard-server and lifecycle-server. No gameplay assertions failed; room-server cleanup also failed after its setup timed out. The cause of those timing failures was not established.
- Isolated rerun: `pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000`: **260 tests passed across 26 files in 95.04 seconds**. Longer limits were supplied only to the command; test configuration was not changed.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: both web and server production builds passed. The public URL was a process-only override.
- `pnpm build:local`: fixture builds passed.
- `NEON_TEST_MATCH_SECONDS=45 NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/moving-lasers.spec.ts`: **one test passed in 53.8 seconds** (41.9-second test). Two independent browser contexts received identical moving snapshots; reload recovered motion; completed feedback and the next pattern displayed; a 375×812 viewport had no horizontal document overflow.
- Desktop active-beam and narrow warning screenshots were visually reviewed: direction/path, red-white active core, amber warning shape, wrapped status and legend were readable.
- `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test`: **11 tests passed, one intentionally skipped, in 3.2 minutes**. The skipped moving-laser scenario passed in the separate 45-second run above; combined executed browser coverage is 12 passing scenarios.
- `git diff --check`: passed; final diff review is recorded below.

Existing regression coverage includes deterministic bounds/one-hazard scheduling, exact 30/60-second transitions, warning timing, shield/invulnerability/dead/disconnected/extracted gating, respawn safety, authentication/authorization, synchronized snapshots, reconnect, extraction/lockdown/results, replay and lobby reset.

## Production verification checklist

After separately approved coordinated server/frontend deployment:

1. Verify health/readiness and authenticated WebSocket connection. Open two independent profiles, create/join a room, ready both and start.
2. At 30 seconds, check matching horizontal-up labels, amber dashed corridor and up arrows; at 31.5 seconds check a red/white moving beam. Compare authoritative positions at equal snapshot ticks.
3. Check completed “beam off” feedback, then left/down/right patterns at the times above. Reload one client during motion and confirm the same current pattern/phase/position resumes.
4. Repeat at desktop and 375-pixel widths. Confirm labels wrap without horizontal page overflow, path bounds are visible and warning shapes differ from active shapes.
5. Test shield blocks, tangency, death/respawn protection and extracted-player immunity. Verify stage three at 60 seconds, frozen prior parameters and new speed from the 62-second warning.
6. Finish extraction/lockdown/results; reload results, host replay and lobby reset. Confirm deadlines, scores and authorization remain unchanged.

## Limitations and boundaries

Automated browser verification uses local fixture authentication/database services, not production Supabase. Production Phase 5C, physical-device and non-Chromium verification remain pending. Rendering follows received snapshots (existing 15 Hz delivery), with no new hazard prediction. The four paths already existed; this phase exposes their identity and improves readability rather than changing balance. Narrow viewport support does not add touch controls.

No secrets, real environment files, Auth configuration, migrations, RLS, lease rules, Render/Vercel configuration or production resources changed. No commit, deployment or Phase 5D work occurred.

## Final Git review

The complete tracked diff and all three untracked files were reviewed. The tree initially had no local modifications; there are no unrelated changes to preserve or displaced investigation files. HEAD remains f692eb7 on main. Eight tracked files are modified and three files are untracked. No files are staged. Final status:

```text
 M apps/server/src/moving-hazard-server.test.ts
 M apps/web/src/Arena.tsx
 M apps/web/src/HealthHud.tsx
 M apps/web/src/style.css
 M packages/protocol/src/index.ts
 M packages/simulation/src/hazards.ts
 M packages/simulation/src/moving-hazards.test.ts
 M tests/browser/moving-lasers.spec.ts
?? apps/web/src/hazard-presentation.test.ts
?? apps/web/src/hazard-presentation.ts
?? docs/phase5c-report.md
```

Final validation passes with the documented longer-limit unit-suite rerun. The initial timing failures remain recorded above rather than being counted as passes. Production verification remains pending explicit approval and the checklist.
