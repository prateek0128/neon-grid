# Phase 3B — Dash and Shield

Implemented on the existing Phase 3A foundation (`71b8f67`), preserving the separate authentication fix (`d2ba9c5`). The user reports live Phase 2 verification. Phase 3A/3B live gameplay acceptance is still unverified; results below use local fixtures. No database migration, RLS/grant change, authentication configuration change or deployment occurred.

## Ability rules

| Ability | Controls | Duration | Cooldown from activation | Movement/state |
| --- | --- | --- | --- | --- |
| Dash | Space or HUD button | Six 30 Hz steps / 0.2 simulation seconds | 150 ticks / 5 seconds | Fixed unit direction, 3× normal speed (630 px/s), up to 126 pixels |
| Shield | E or HUD button | 60 ticks / 2 seconds | 360 ticks / 12 seconds | Server-owned defensive state and visible ring; no damage behavior yet |

Shared constants are `ABILITY_RULES` in `@neon/protocol`. Recent direction comes only from non-zero server-accepted movement within the preceding 1000 milliseconds of server monotonic time. Neutral input preserves this direction briefly. No direction means `NO_DIRECTION`; no cooldown is consumed. Reconnect clears direction memory, so move first before dashing again. Dash locks its direction for the burst; normal input cannot redirect it mid-burst. Its cooldown is consumed even if the arena boundary limits travel.

Dash advances inside the same authoritative fixed-step loop and uses the existing body-radius boundary clamp. The current arena has no interior walls or player-body blocking. Core collection still checks authoritative proximity after each movement step; client rendering never awards points. The 21-pixel maximum dash step is shorter than the 44-pixel collection diameter, with the same sampled proximity rules as normal movement. Future hazards/interior walls will need their own collision rules in Phase 3C.

Shield timestamps and cooldowns use `gameplay.tick`, never browser clocks. A shield is active while `tick < shieldUntilTick`; cooldown is complete at `tick >= readyAtTick`. Timing pauses with unhealthy match simulation and follows the existing bounded catch-up behavior on process stalls. There are no extra simulation loops or per-player ability timers.

## Protocol and authoritative validation

One new client envelope:

```text
{ type: 'ability', version: 1, sessionId, sequence, ability: 'dash' | 'shield' }
```

The request has no direction, position, speed, destination, score, cooldown or expiry values. Exact-key parsing rejects extra fields and unknown abilities. Requests share the same increasing sequence stream and message-rate bucket as movement. The server checks verified session identity/expiry, active room-match arena, healthy room authority, current eligible membership and socket ownership before activation. Cooldowns are checked against server state. Replays fail sequence checks; repeated fresh requests cannot extend abilities or reset cooldowns; excessive requests close the socket through existing rate limiting.

Ordinary denials send `{type:'ability_rejected',version:1,ability,reason:'COOLDOWN'|'NO_DIRECTION'}` without closing a healthy socket. The client displays the reason. Malformed, unauthenticated, roomless, outsider, stale-sequence and invalid-session requests retain the existing terminal rejection conventions. Abilities are unavailable on the explicit development movement-only arena, as well as before a room match starts and after cleanup.

Snapshots add these optional fields under `gameplay` (always included by the updated room-match server):

- `abilities[{id,dashUntilTick,dashReadyAtTick,dashDirection,shieldUntilTick,shieldReadyAtTick}]`, keyed by membership ID, maximum four.
- `abilityEvents[{sequence,tick,playerId,ability,position,direction}]`.

Collection and ability events share the existing `nextEvent` counter. Both arrays remain individually ordered and jointly retain the latest sixteen entries, preventing unbounded history and duplicate event identities. Snapshot parsing validates numeric ranges, unique ability identities, bounded directions, deadlines and event order, including cross-array sequence collisions. Reading an event never activates an ability or awards points. Update browser and server together; mixed-version rollout is not an acceptance claim.

The HUD derives integer remaining seconds from snapshot tick/deadline values. It disables unavailable abilities but never claims activation optimistically. Space/E ignore editable fields and keyboard repeat; controls/listeners reuse the existing socket cleanup. Canvas renders a short neon dash trail and synchronized shield ring from authoritative state/events. No browser gameplay storage or database writes were added.

## Reconnect and lifecycle

Ability state is allocated for all eligible members when the server activates the match and is reconciled alongside scores. It lives independently of the position reconnect grace. Socket closure cancels a dash immediately without resetting its cooldown; shield and cooldown deadlines continue while the active match remains healthy. Reconnect restores the current state, without replaying requests or emitting duplicate activation events. Expired shields stay inactive, even if the client reloads.

Removed membership is pruned on existing room reconciliation. Return to Lobby, abort, expiry and shutdown clear the arena and all abilities. A fresh match starts with zero deadlines and empty ability event history. Server restart uses existing lease recovery and aborts the old run; state is not durable. Existing one-second room reconciliation/five-second freshness bounds and one-replica assumption remain unchanged.

## Checks and results

- TypeScript: passed.
- Full automated suite: **99 tests passed across 11 files**, including all Phase 2/3A regressions.
- New coverage: deterministic direction/normalization, six-step dash integration, cooldown boundaries, repeated activations, all arena corners, two-second shield expiry/twelve-second cooldown, shared event ordering, snapshot isolation and membership pruning; controlled-clock socket coverage for dash/expiry/reconnect/cooldowns, stale direction, spam, unauthenticated/outsider/roomless/inactive access, match reset and payload tampering; strict protocol validation.
- Full browser suite: **8 tests passed**, including all previous auth/room/movement/core regressions and two-session shield visibility, reload with active shield/cooldown, dash movement, HUD controls and fresh match reset.
- Browser and persistent server production builds: passed.
- Live Supabase Phase 3B gameplay: **not performed**. Fixture-backed browser tests are not live Supabase evidence.

Ability socket tests control interval scheduling, Node monotonic time and server wall time; actual socket I/O remains real. The initial targeted run exposed an incorrectly controlled test clock (Node `perf_hooks` was still real); the corrected harness and all final checks passed. Browser trace recording is disabled for the new two-context test using the Phase 3A artifact-transport workaround; assertions and the shield screenshot remain enabled. Existing regressions retain their tracing behavior.

## Local commands

Use the existing ignored environment configuration; no new credentials or runtime variable is required. Start from the repository root:

```sh
pnpm dev
# Or separate terminals:
pnpm --filter @neon/web dev
pnpm --filter @neon/server dev

pnpm typecheck
pnpm test --maxWorkers=1 --hookTimeout=30000
pnpm build
NEON_TEST_WEB_PORT=5174 pnpm test:browser
```

Browser: `http://127.0.0.1:5173`. Game server: port 8787. Browser regressions use isolated fixture services on 9100/9101 and port 5174 to preserve any running live development browser.

## Two-browser live verification

1. Restart/reload the updated browser and server. Open the local browser URL in a normal and private window/profile with isolated session storage.
2. Create/join with distinct callsigns, ready both and start from the host. Confirm distinct YOU identities and unchanged eight-core/score behavior. Ability controls should be absent in the lobby.
3. Press Space before moving. Expect a direction hint, no movement and no consumed cooldown. Move with WASD or arrows, then press Space within one second. Both windows should show the faster burst/trail in that direction and a five-second local cooldown.
4. Hold Space or press it repeatedly. It must not extend the burst or bypass cooldown. At the arena edge, dash must stop at the body boundary; changing input mid-burst must not nominate a new dash destination. After five seconds, movement plus Space should activate again.
5. Press E or click Shield. Both windows should see the ring; the local HUD should count down twelve seconds. The ring expires after two seconds. Repeated requests must not extend it, and another activation remains unavailable until twelve seconds from the original activation.
6. Activate Shield and immediately reload that player. If still within the two-second window, the ring should return with the original remaining duration and cooldown. Reloading after expiry must not recreate it. Disconnect during Dash: it should stop, with cooldown preserved on reconnect.
7. Collect cores normally and during Dash. Both scoreboards must agree; combos and respawn rules remain unchanged. Repeat independently with the other player.
8. Return to Lobby. Both lose the active HUD/ability state. Start again: both abilities begin ready, shield inactive, scores zero. Exercise leaving/host transfer, reconnect and outsider admission restrictions again.

Do not share tokens, request headers or server secrets in screenshots/logs.

## Files changed

```text
README.md
apps/server/src/server.ts
apps/server/src/ability-server.test.ts
apps/web/src/App.tsx
apps/web/src/Arena.tsx
apps/web/src/AbilityHud.tsx
apps/web/src/connection.ts
apps/web/src/keyboard.ts
apps/web/src/style.css
packages/protocol/src/index.ts
packages/protocol/src/protocol.test.ts
packages/simulation/src/index.ts
packages/simulation/src/gameplay.ts
packages/simulation/src/abilities.ts
packages/simulation/src/abilities.test.ts
tests/browser/abilities.spec.ts
docs/architecture.md
docs/phase3a-report.md
docs/phase3b-report.md
```

Dependency manifests/lockfile, migrations, RLS, room permissions and authentication configuration are unchanged. Existing untracked `supabase/config.toml` and `supabase/.gitignore` remain untouched and outside this commit.

## Limitations and next phase

Shield is synchronized defensive state only; Phase 3C will consume it for explicitly approved hazard/damage mechanics. No lasers, health, damage, extraction or match timers were implemented. Gameplay remains one-replica server memory and is lost on restart/abort. No touch movement, prediction, physical-device or non-Chromium acceptance was added. Durations are simulation time and cooldown feedback updates at snapshot cadence. Browser effects are visual only; network latency can delay their display. Dedicated live Phase 3A/3B verification remains pending.
