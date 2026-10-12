# Feature expansion report

## Scope

This expansion retains the HTTP-only authoritative architecture. The server continues to own simulation ticks, movement, hazards, extraction, results, layouts and power-up collection. No WebSocket/Realtime transport, migration, RLS/Auth setting, real environment file, production service, deployment or commit was changed.

The existing working tree was inspected first: `main` at `da5828e`, with the HTTP migration and final-audit work already uncommitted. Those files were preserved. This report records only this expansion on top of that work.

## Implemented features

### Final-round polish

- The countdown is derived solely from authoritative snapshot ticks. The final ten seconds receives an explicit lockdown warning.
- Extraction status gains a stronger open-zone treatment, while results add a personal victory/tie/defeat line based on the finalized authoritative ranking and extraction outcome.
- Existing duration, scoring, extraction timing, ranking and lifecycle behavior are unchanged.

### Personal records

- Browser-local record tracks wins, losses, highest score/personal best and cores collected.
- Records consume only finalized server results, deduplicate by authoritative match ID, and retain the last 100 IDs to avoid accidental duplicate counting after polling/reload.
- There is no new database table or RPC. Therefore these records are local to the browser and can be cleared with browser storage; they are not cross-device persistent or a server-backed leaderboard. Secure durable persistence needs a separately reviewed authenticated database/RPC design.

### Power-ups

- Three server-owned pickups enter at simulation seconds 10, 35 and 55: speed (five seconds at 1.35× ordinary movement), bonus (+150 points) and energy (readies Dash/Shield cooldowns).
- Spawning, bounds, collection, score, eligibility and effects execute in `advanceGameplay`. Clients receive only snapshot state and cannot nominate a pickup, collector, score or duration.
- Power-ups spawn on valid arena cells away from players, cores, active power-ups and layout obstacles. They are one-per-match and do not alter hazard damage, extraction, match duration or base abilities.

### Arena variations

- Every generation deterministically selects Neon Grid, Data Vault or Crossroads from its server-issued generation ID.
- Data Vault and Crossroads contain collision barriers; movement and Dash use sub-stepped, server-side collision resolution so they cannot cross a thin obstacle between snapshots.
- Arena ID, label and obstacle geometry are authoritative snapshot data. Each layout supplies a valid extraction zone and uses the same arena boundary, laser sweep rules, respawns and score systems.

### Cosmetics

- Players can choose a color and line/dots/spark trail in the landing screen. The setting uses local browser storage only.
- Canvas uses the local cosmetic for the current player, without changing physics, visibility of authoritative players, score, collision, abilities or protocol messages.

## Files changed for this expansion

- `packages/protocol/src/index.ts`
- `packages/simulation/src/arena-layouts.ts`
- `packages/simulation/src/index.ts`
- `packages/simulation/src/gameplay.ts`
- `packages/simulation/src/abilities.ts`
- `packages/simulation/src/feature-expansion.test.ts`
- `apps/web/src/round-presentation.ts`, `round-presentation.test.ts`
- `apps/web/src/player-stats.ts`, `player-stats.test.ts`
- `apps/web/src/cosmetics.ts`, `CosmeticsPicker.tsx`
- `apps/web/src/Arena.tsx`, `ExtractionHud.tsx`, `Results.tsx`, `App.tsx`, `style.css`
- `tests/browser/feature-expansion.spec.ts`
- `docs/feature-expansion-report.md`

## Validation

Focused checks completed before browser validation:

```sh
pnpm exec vitest run packages/simulation/src/feature-expansion.test.ts packages/simulation/src/gameplay.test.ts apps/web/src/player-stats.test.ts apps/web/src/round-presentation.test.ts --maxWorkers=1
# 13 passed across 4 files

pnpm typecheck
# passed

pnpm build:local
# web and server builds passed
```

Further validation completed:

```sh
NEON_TEST_WEB_PORT=5174 pnpm exec playwright test tests/browser/feature-expansion.spec.ts tests/browser/abilities.spec.ts tests/browser/movement.spec.ts
# 4 passed in 43.5 seconds; WebSocket construction remained blocked by the HTTP-only fixture.

pnpm exec vitest run --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
# 298 passed across 34 files in 102.52 seconds.

VITE_GAME_SERVER_URL=https://neon-grid-server-uske.onrender.com/ pnpm build
# TypeScript and both production builds passed.
```

An initial full-suite run found that a barrier overlapped a long-standing Dash regression route. The barriers were moved to preserve that existing normal route; the focused server/simulation rerun passed 13 tests, and the complete suite then passed. A browser attempt that assumed the cosmetics picker remained visible in-room was corrected to verify persisted local storage after reload. These failed diagnostic attempts are not counted as passing validation.

## Manual verification

1. In two isolated browser profiles, create/join, ready and start. Confirm both receive the same layout title, barriers, extraction zone and power-up positions.
2. At 10 seconds, collect speed and compare the same player’s movement before/during/after five seconds. At 35 seconds collect bonus and verify exactly +150 in both scoreboards. At 55 seconds put abilities on cooldown, collect energy and verify both are ready. Check a dead/extracted player cannot collect.
3. Dash toward each barrier in Data Vault/Crossroads; the player must stop or slide without crossing. Check cores/power-ups never appear inside barriers.
4. Enter the final ten seconds and confirm the warning; open extraction and finish. Reload results and confirm a local record increments once. Revisit/reload results and confirm it does not increment again.
5. Choose cosmetics, reload, and confirm the current player’s presentation persists locally while another profile retains its own setting. Verify both players’ positions, collision and score remain identical.

## Limitations

- Personal records and cosmetics are intentionally local-only. No durable cross-device stats, shared cosmetic profile or unlock inventory was added because doing so securely requires new authenticated database/RPC work.
- Layout selection is deterministic per generation, rather than host-selectable, to avoid an extra pre-match protocol and persistence flow.
- Automated checks are local fixtures; production, physical-device and non-Chromium verification remain unperformed.
