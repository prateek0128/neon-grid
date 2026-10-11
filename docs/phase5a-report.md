# Phase 5A — authoritative extraction and lockdown

## Rules and tick order

One circular extraction zone is fixed at arena coordinates (480, 320), radius 60 pixels, in the existing 960×640 arena. Qualification uses the authoritative player center; distance less than or equal to 60 qualifies. Body overlap alone does not qualify.

The default extraction window is the final 20 simulation seconds of the existing 90-second match: it opens at tick 2100 and closes after processing tick 2700. The optional server-only `EXTRACTION_WINDOW_SECONDS` setting accepts integer seconds 1–3600, defaults to 20, and is clamped to the match duration. A shorter match can therefore open extraction immediately. No real environment file or production setting was changed. The local browser fixture explicitly uses a five-second window in its existing twenty-second match.

The existing fixed-step loop processes movement, advances the match clock, processes damage/respawn, awards eligible collection, then automatically extracts connected living eligible players. The deadline tick is included. A lethal hazard therefore prevents extraction that tick; collection points awarded before extraction still count. The same step resolves lockdown and invokes the existing exactly-once results finalization. There is no extraction request, second timer, new results system or extraction bonus. Rankings, ties and cumulative core totals use the existing rules.

Extracted players remain visible at their frozen position. Movement, collection, damage and abilities cannot affect them; active dash/shield effects are cancelled without resetting cooldowns. Duplicate evaluation cannot change extraction time or outcome. At lockdown, extracted participants remain extracted, remaining living/disconnected participants are locked down, and currently respawning eligible participants receive the terminal `dead` outcome. Dead players can still respawn normally before the deadline; death is terminal only when lockdown resolves. Departed participants retain their score ledger and extraction history; a departed non-extracted participant is recorded as locked down.

## Protocol, authority and UI

Authoritative gameplay snapshots carry extraction phase (`closed`, `open`, `lockdown`), zone, opening/closing tick, remaining ticks and per-participant outcome/extraction tick. Results rankings add the outcome without changing rank calculation. Validation rejects inconsistent deadlines/phases, duplicate identities, impossible extraction times and invalid outcomes. The envelope remains protocol version 1 with additive snapshot fields, matching the existing optional gameplay extensions. Coordinate/time/success fields forged into client envelopes fail existing exact-field validation; no client extraction command is accepted. An extracted player's ability intent receives the safe `EXTRACTED` rejection.

All eligibility comes from the server's current reconciled roster, verified open socket, valid session, authoritative vitals and positions. Disconnected players cannot extract from stale positions. Existing reconciliation freshness, membership checks, sequencing, rate limits and server-only Supabase maintenance remain intact. No schema, migration, RLS, grant or authentication setting changed.

The existing Canvas shows the zone with a purple closed outline and teal open outline/fill. A snapshot-derived status displays time until opening or lockdown and local extraction status. The roster and results table show outcomes; the canvas labels extracted players. Ability controls disable after extraction. The existing responsive canvas and table layout remain in use, without a UI redesign.

## Lifecycle integration

Reconnect restores extraction state from server memory, including finalized outcomes in results. Extracted player positions are retained beyond the ordinary fifteen-second position grace, while membership still exists; reconciliation still removes revoked membership. This does not extend the database's thirty-second membership lifetime. Replay creates fresh extraction timing, alive outcomes, null extraction timestamps and a new generation through the existing host-only reset. Host lobby return retains the existing user-scoped RPC, authorization, readiness clearing and arena disposal. No extraction state survives an arena reset or server replacement.

## Files changed in this phase

- `packages/protocol/src/index.ts`
- `packages/simulation/src/gameplay.ts`
- `packages/simulation/src/hazards.ts`
- `packages/simulation/src/abilities.ts`
- `packages/simulation/src/extraction.test.ts` (new)
- `apps/server/src/config.ts`, `config.test.ts`, `index.ts`, `server.ts`, `lifecycle-server.test.ts`
- `apps/web/src/ExtractionHud.tsx` (new), `AbilityHud.tsx`, `App.tsx`, `Arena.tsx`, `Results.tsx`, `connection.ts`, `style.css`
- `tests/browser-services.ts`, `tests/browser/extraction.spec.ts` (new)
- `docs/phase5a-report.md` (new)

Existing modified/untracked readiness and production-WebSocket investigation files were preserved. No commit, deployment, production process stop, production lease mutation, provider configuration, production environment or secret change was performed.

## Validation

All checks use local fixtures, not production.

- `pnpm typecheck`: passed on the final source.
- Initial focused simulation/protocol/lifecycle run: 65 tests passed across four files.
- Focused extraction/configuration run: 43 tests passed across two files.
- Final focused extraction/lifecycle repeat: nineteen tests passed across two files in 2.66 seconds.
- Focused lifecycle run, including extraction reconnect beyond fifteen seconds: seven tests passed.
- Final `pnpm test --maxWorkers=1`: 242 tests passed across 23 files in 95.22 seconds. This includes fourteen new cases covering timing, boundaries, eligibility, tampering, damage/collection ordering, extracted participation, snapshot validation, configuration and reconnect/replay.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: web and server production builds passed; the public URL was supplied only for that process, with no environment-file change.
- `pnpm build:local`, then `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/extraction.spec.ts tests/browser/results.spec.ts`: both tests passed in 1.4 minutes against isolated fixtures. The subsequent full browser run includes the strengthened identical-outcome assertion.
- During implementation, TypeScript caught an incorrect renderer snapshot-property access; it was corrected before final validation. No final test failures remain.
- `NEON_TEST_WEB_PORT=5174 pnpm exec playwright test`: all eleven Chromium tests passed in 3.0 minutes, including the strengthened extraction/outcome comparison and existing Auth, abilities, cores, hazards, results, movement/reconnect and rooms regressions.
- Browser screenshot of the closed zone and countdown was visually reviewed at the existing desktop layout.
- `git diff --check`: passed; current diff reviewed. Existing production-investigation changes are retained.


## Manual two-browser verification

After separately approving a coordinated web/server deployment, use two independent browser profiles on the production frontend:

1. Create/join a room, ready both players and start. Confirm distinct identities, shared clock and matching closed-zone/opening countdown.
2. Move one living player into the center zone before the final twenty seconds. Keep the other outside. Opening should automatically mark the first extracted in both clients. No button or client outcome assertion is required.
3. Try movement, Dash and Shield after extraction. Position and score must remain frozen, and hazards must not damage the extracted player. Reload that profile; extraction status and position should recover while membership remains valid.
4. At the deadline, compare final rankings, scores, core totals and extraction outcomes in both profiles. The outside player should be locked down; a player currently awaiting respawn should be dead. Reload results and compare again.
5. Host Play Again: require a fresh countdown, closed zone (with default duration), alive statuses, reset health/score/abilities and stable member identities. Host Return to Lobby: both clients recover lobby/readiness; a later start must contain no old extraction outcome.
6. Check boundary qualification and lethal deadline damage in deterministic automated tests; network-delayed screenshots alone cannot establish exact-tick ordering. Briefly interrupt a non-extracted client's connection and verify stale positions do not trigger extraction.

Phase 5A has not been verified in live production. Existing transport/core-gameplay production confirmation predates these changes.

## Known limitations

One persistent server replica and memory-only gameplay/results remain. Restart aborts matches rather than recovering outcomes; expired membership cannot rejoin an in-progress room. Time advances with healthy simulation, not guaranteed wall time. The zone is fixed with no balancing or alternative escape locations. Extraction rewards, moving lasers, difficulty scaling, touch movement, audio and persistent results history are outside this phase. Physical-device and non-Chromium acceptance remain unverified.

## Final Git state

HEAD remains `cac6ee8`. There are eighteen modified tracked files and ten untracked files, including the preserved earlier investigation work. Nothing was committed or deployed. Phase 5A source changes are limited to the exact list above. Production acceptance remains pending the manual verification checklist.
