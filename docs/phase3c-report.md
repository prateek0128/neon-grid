# Phase 3C — Server-authoritative security grid

## Implementation and rules

The existing room-scoped, in-memory `GameplayState` is the source of truth. The single authoritative TypeScript WebSocket server advances it at 30 Hz and publishes snapshots at 15 Hz. Supabase remains responsible for identity, room membership and room lifecycle; no gameplay table writes, migrations, grants, RLS or auth configuration were changed.

Shared `HAZARD_RULES` defines 100 maximum/restored health, 50 laser damage, six seconds opening grace, 1.5 seconds warning, one second active, four seconds between warning starts, laser half-width five pixels, three seconds respawn delay and 1.5 seconds respawn invulnerability. Shield remains two seconds active with twelve seconds cooldown; Dash remains unchanged.

One full-arena laser follows a repeating eight-line sequence: horizontal y=220, vertical x=640, horizontal y=420, vertical x=320, horizontal y=100, vertical x=800, horizontal y=540, vertical x=160. Warning starts at match tick 180; first activation is tick 225. Deadlines use the match simulation clock, which pauses when trusted room synchronization becomes unavailable. Slow-process catch-up retains the existing bounded-step behavior.

Collision includes player radius and uses the previous-to-current authoritative movement segment, so Dash cannot tunnel through an active beam. A member gets at most one collision outcome per activation, including a shield or invulnerability block. A blocked activation remains consumed even if protection expires while that same beam stays active. Protection on a later activation uses its current expiration tick; equality means expired. Disconnected members do not take damage. Damage precedes collection in each step, so a lethal hit prevents collecting in that step.

Health is clamped at zero. Death pauses movement and core collection, rejects abilities with a nonterminal `DEAD` result, cancels active Dash/Shield and clears movement intent. Cooldowns continue on the match clock. Earned points remain; death resets the combo and multiplier. Respawn restores 100 health and chooses a deterministic grid cell nearest the member's original spawn, avoiding other bodies, cores and warning/active beams. Selection is stable by slot, distance, y and x. Disconnected dead members also respawn on schedule, retaining their safe position for reconnect. After respawn, fresh input resumes movement.

Health, life state, respawn deadline/location, protection deadline, laser phase/deadlines and health outcomes travel in room snapshots. Health, ability and collection events share one sequence counter and a combined 16-event history. State survives reconnect while the match is active; returning to lobby discards the arena and a new match starts fresh. Process restart still loses in-memory match state. The existing single-server-replica lease limitation remains.

## Client and security

Canvas shows amber dashed warnings, red active beams, damage/block rings and labels, faded dead bodies, respawn countdowns and white dashed protection rings. The responsive HUD and roster show health, life/protection status and laser phase. Dead players' ability buttons are disabled; server enforcement also covers keyboard or forged requests. All countdowns derive from snapshots, without client time controlling outcomes.

Clients still send only authentication, movement intent and ability activation intent. Exact-key validation rejects client-supplied health, damage, positions, collision and lifecycle fields/messages. Existing identity verification, room membership checks, sequence checks, rate limits, origin restrictions and cleanup remain. Server keys never enter browser code. New snapshot parsing bounds health/events and validates life/deadline consistency and hazard timing. Optional extensions retain compatibility with the development movement-only arena and older snapshot shapes; deploy matching client/server versions for Phase 3C.

## Files changed

- `packages/protocol/src/index.ts`, `protocol.test.ts`: shared hazard/vitals/events, rejection reason, snapshot validation and forged-outcome coverage.
- `packages/simulation/src/hazards.ts`, `hazards.test.ts`: deterministic scheduling, swept collision, damage, shield/protection checks, safe respawn and lifecycle tests.
- `packages/simulation/src/gameplay.ts`, `abilities.ts`, `index.ts`: match state, collection/movement/ability gating and shared event pruning.
- `apps/server/src/server.ts`, `hazard-server.test.ts`: authoritative previous positions, respawn relocation, input gating and socket lifecycle/security tests.
- `apps/web/src/HealthHud.tsx`, `AbilityHud.tsx`, `App.tsx`, `Arena.tsx`, `connection.ts`, `style.css`: health/laser feedback and dead-state controls.
- `tests/browser/hazards.spec.ts`: two isolated browser contexts covering synchronized lasers/damage, shield protection, injured/dead reload, frozen movement, respawn protection and lobby/new-match reset.
- `docs/phase3c-report.md`: this report.

Existing untracked `supabase/.gitignore` and `supabase/config.toml` are unrelated user files and excluded from this implementation commit. No dependencies or environment files changed.

## Validation

- `pnpm typecheck`: passed.
- `pnpm test --maxWorkers=1 --hookTimeout=30000`: **126 passed in 13 files**. Coverage includes deterministic timing/collision, one-hit activations, clamped damage, shield expiration/cooldown, dead collection/ability/movement gating, respawn spacing/protection, reconnect and match cleanup, protocol/socket tampering and all existing regressions.
- `pnpm build`: browser and server production builds passed, including the final rebuild after the body-spacing correction.
- `NEON_TEST_WEB_PORT=5174 pnpm test:browser`: **9 passed**, including all prior Phase 2/3A/3B browser regressions and the new two-context Phase 3C test. Uses local auth fixtures and SQL RPCs plus the actual WebSocket server. Focused repeat after the body-spacing correction: **1 passed** (two isolated browser sessions).
- `git diff --check`: passed. The generated respawn screenshot was visually inspected; HUD, roster health, warning line, protection ring and ability controls are readable.


## Manual live verification

1. With existing local environment configured, run `pnpm dev` from the repository. Browser is `http://127.0.0.1:5173`; WebSocket endpoint is `ws://127.0.0.1:8787/ws`.
2. Open a regular browser window and an incognito window (or two distinct browser profiles). Separate tabs in one profile share Supabase identity and are not independent players.
3. Create a room as Cipher; join its code as Ghost in the other session. Ready both, then start as host. Check distinct identities and 100 HP for both.
4. Keep both at their default spawns. At six match seconds, both see the horizontal amber warning. Activate Cipher's shield during that warning. At 7.5 seconds, Cipher stays at 100 HP with a block indication; Ghost drops to 50 HP in both views. After 8.5 seconds the beam turns off.
5. Reload Ghost and verify identity/50 HP persist. Keep Ghost at x=640. The second warning begins at ten seconds and activates at 11.5 seconds: Ghost reaches zero and cannot move, collect or activate abilities. Reload while dead to verify recovery of its respawn state.
6. At approximately 14.5 seconds Ghost respawns at a safe cell with 100 HP and 1.5 seconds protection. Both views agree; movement resumes with fresh input. Scores remain and its combo resets.
7. Return to lobby as host, ready both and start another match. Health, hazard schedule, events, scores and abilities reset.

These live-project steps have not been performed during Phase 3C. The executed browser checks use local fixture authentication and SQL room RPCs with the actual game server, not the live Supabase project.

## Limitations

One arena, one scheduled full-width or full-height line at a time; no moving lasers or difficulty escalation yet. The event history is bounded and transient, so old visual feedback can disappear on long disconnects while current health/lifecycle survives. Presentation interpolates movement and may visually ease a respawn relocation; authoritative position changes immediately. Mobile HUD layout uses existing responsive styles; touch movement controls remain outside this phase. No production deployment or multi-replica support was added. Phase 3D has not started.
