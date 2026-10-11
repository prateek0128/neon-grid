# Render readiness investigation

No deployment, commit, process stop, environment change, migration, RLS change, lease deletion or forced replacement was performed. Earlier uncommitted WebSocket investigation changes are preserved.

## Current evidence and limits

Live GET checks again showed Render `/health` 200 (`ok`) and `/ready` 503 (`not_ready`). The existing local server on port 8787 showed both endpoints 200 and a listening process. Local readiness is evidence of a healthy local authority, not proof of Render's specific RPC failure or its configured database project.

No Render log file or connector is available. The dashboard check reached the sign-in page; no login was attempted. Current production diagnostics and deployed commit remain required to establish the exact underlying error. A corrected allowlist cannot fix readiness because Origin is absent from the readiness calculation.

## Every readiness condition

The production entrypoint constructs a room store and validates configuration before listening. HTTP requests reaching `/ready` already establish a listening process. `/health` 200 establishes it is not closing at that instant. For the inspected production entrypoint, the remaining readiness failure is an unsuccessful or stale room reconciliation; public status alone cannot distinguish them.

The extracted pure `readinessCondition` reports:

| Condition | Meaning |
| --- | --- |
| `closing` | Shutdown has begun |
| `not_listening` | HTTP listener not active |
| `room_store_missing` | No room authority and no explicitly enabled development test arena |
| `authority_pending` | Initial room reconciliation has not completed and no failure has been recorded |
| `authority_unhealthy` | Reconciliation failed, including any known RPC/lease error or processing failure |
| `authority_stale` | Last successful reconciliation is older than five seconds; can occur while a renewal remains in flight |
| `ready` | All gates pass; the exact five-second boundary remains accepted |

The public response remains only status/protocol. Logs now emit a bounded `readiness` event with condition, `syncInFlight` and optional safe `authorityFailure` classification, on transitions and every thirty seconds while not ready. Connection and readiness/authority diagnostics have independent budgets of sixty events per minute each, plus one suppression marker per budget. Connection traffic cannot suppress readiness diagnostics. A `diagnostics_limited` event names its `scope`; absence of a log during readiness-budget suppression is not proof of health. No instance ID, URL, header, RPC payload, error text, credential or token is emitted.

`authorityFailure` distinguishes `lease_busy`, `rpc_permission`, `rpc_failure`, `invalid_response` and `unknown`. The server sends an initial tick, then ticks every second. `syncInFlight` prevents concurrent renewals, and Supabase requests have a four-second timeout. Success is now marked after arena reconciliation completes, so a failed processing step cannot emit a false recovery log.

## Lease lifecycle, unchanged

Each server process generates a random epoch used as `p_instance_id`. The server-only `ng_server_tick` RPC:

1. Inserts a singleton lease if missing, initially expiring ten seconds ahead.
2. Locks its row using `FOR UPDATE`, serializing acquisition and renewal.
3. Returns `SERVER_BUSY` if a different owner still has an unexpired lease.
4. Otherwise renews or takes over naturally, setting expiry ten seconds ahead; writes become visible only if the transaction commits.
5. Fences matches from an earlier owner on takeover, returning them to lobby rather than pretending memory survived.

An expired row is not an indefinite blocker. A still-running competing process can renew indefinitely. A dependency/permission failure or blocked transaction can also prevent successful reconciliation and must not be confused with lease contention. Server shutdown stops renewals and does not delete the lease. No live tick RPC was called as a diagnostic because that could acquire/renew authority and alter rooms.

## Smallest safe action

The confirmed code defect is insufficient readiness observability, including recovery logged before reconciliation had fully completed. The prepared fix identifies the exact failed gate and logs recovery only on completion. No evidence currently authorizes a lease-rule or database-policy change.

Obtain the current Render `authority_unavailable` and `readiness` lines plus deployed commit. If `lease_busy` is confirmed, identify the unwanted renewing process and deliberately stop it in a controlled window, or use separate development and production projects. Wait at least ten seconds plus the next reconciliation; do not erase or replace the lease. If `rpc_permission` is confirmed, verify the intended server-only key/project against the already-applied migration privately. For `rpc_failure`, inspect availability/timeout privately. `authority_pending`/`authority_stale` with `syncInFlight=true` requires investigating the blocked reconciliation, rather than changing ownership.

A read-only check in the Supabase SQL editor can distinguish an actively renewed lease from an expired row without revealing the owner ID:

```sql
select lease_until > clock_timestamp() as lease_active,
       greatest(0, extract(epoch from lease_until - clock_timestamp())) as seconds_remaining
from ng_private.runtime
where singleton = true;
```

Sample it twice several seconds apart. A repeatedly renewed expiry indicates an active owner, but does not by itself identify which process owns it. This query was prepared, not executed against production.

## Verification

Regression coverage adds all readiness conditions, the five-second boundary, busy-lease failure/recovery and a stalled renewal that becomes stale while in flight. Existing database tests cover competing-owner fencing and takeover after expiry. Public readiness details remain private in tests.

- `pnpm typecheck`: passed.
- `pnpm test --maxWorkers=1`: all 222 tests across 22 files passed in 80.27 seconds.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: web and server production builds passed; process-only URL override, no environment-file change.
- `git diff --check`: passed; readiness implementation and tests reviewed.

After reviewing and approving the diagnostic deployment, request `/ready` and inspect the safe Render log line. Require `condition=ready` and HTTP 200 after the identified cause is corrected, then verify a controlled authenticated WebSocket match. Frontend URL, `ALLOWED_ORIGINS`, schema, RLS and lease ownership rules remain unchanged. Production root cause is not confirmed until the deployed diagnostic evidence is available.

## Follow-up review: diagnostic reliability

The follow-up review found two gaps in the prepared diagnostics, not a confirmed production root cause:

- A shared sixty-event budget allowed invalid upgrade traffic to suppress authority/readiness logs. These now use an independent bounded budget; a regression exhausts connection logging before checking pending reconciliation and a subsequent busy-lease failure.
- A rejected or synchronously thrown RPC exception previously reached the server as `unknown`. The tick RPC now sanitizes that exception to `rpc_failure`. Local arena-processing exceptions still classify as `unknown`, and a regression ensures they cannot emit false recovery.

Additional server tests check `rpc_permission`, `rpc_failure` and `invalid_response` reaching the readiness log. No raw exception, response detail, request URL, credential, token, environment value or user identifier is logged. All readiness gates, RPC arguments and lease rules are unchanged.

Look for these exact messages (JSON key order is not significant):

```text
NEON GRID connection {"event":"readiness","condition":"authority_pending","syncInFlight":true}
NEON GRID connection {"event":"authority_unavailable","reason":"lease_busy"}
NEON GRID connection {"event":"readiness","condition":"authority_unhealthy","syncInFlight":false,"authorityFailure":"lease_busy"}
NEON GRID connection {"event":"readiness","condition":"authority_stale","syncInFlight":true}
NEON GRID connection {"event":"authority_recovered"}
NEON GRID connection {"event":"readiness","condition":"ready","syncInFlight":false}
NEON GRID connection {"event":"diagnostics_limited","scope":"connections"}
```

Failed reconciliation can instead carry `rpc_permission` (PostgreSQL 42501), `rpc_failure` (other RPC errors or rejected requests), `invalid_response` (unexpected RPC response), or `unknown` (unclassified local processing failure). These are categories, not diagnoses of the precise remote cause; `rpc_failure` intentionally does not disclose HTTP bodies or dependency error text. A stale successful reconciliation differs from a recorded failure, which remains `authority_unhealthy` during retry. Persistent non-ready conditions repeat every thirty seconds unless the readiness budget is explicitly suppressed.

The local lease owner has not been identified. Local readiness alone cannot establish ownership when the test arena is enabled. Do not stop a process or replace a lease on that basis. Obtain the deployed commit and safe Render diagnostics first; if no diagnostic version is deployed, review and explicitly approve a server-only diagnostic deployment. Require deployed `/ready` HTTP 200 and an authenticated WebSocket welcome/snapshot before reporting recovery.

### Follow-up validation

- `pnpm typecheck`: passed after adapting the RPC exception wrapper to Supabase's thenable builder.
- `pnpm test --maxWorkers=1`: all 228 tests across 22 files passed in 65.85 seconds, including six new diagnostic regression cases.
- `VITE_GAME_SERVER_URL=wss://neon-grid-server-uske.onrender.com/ws pnpm build`: both production builds passed using a process-only public URL override.
- `git diff --check`: passed. Existing unrelated browser lifecycle changes were preserved; no environment/configuration, migration, RLS, lease rule or production resource changed.
- HEAD remains `cac6ee8`; five tracked files are modified and six files untracked. No commit or deployment was performed. No live authentication or lease-owner verification was performed in this follow-up.
