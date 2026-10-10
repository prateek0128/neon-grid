# Phase 2 database setup and security verification

Migration: `supabase/migrations/20261010000100_secure_rooms.sql`.

The migration has been executed only against an isolated local embedded PostgreSQL test database. No dedicated live project was configured, linked, queried or changed.

## Dedicated live project setup

Create/use a project specifically for NEON GRID: CYBER HEIST. Do not link this repository to another game's project. Enable anonymous sign-ins in that project's Authentication settings. Keep any CAPTCHA requirement consistent with the client flow; CAPTCHA integration is not part of this phase.

With the Supabase CLI installed, the following are **manual setup instructions**, not commands run by this task:

```sh
# Generate local CLI configuration if supabase/config.toml does not exist.
supabase init
supabase login
supabase link --project-ref YOUR_DEDICATED_NEON_GRID_PROJECT_REF
supabase migration list
supabase db push --dry-run
```

Check the project reference against the dedicated project's dashboard. The dry run must show only the intended NEON GRID migration. Then apply it to that dedicated development project:

```sh
supabase db push
supabase migration list
```

Supply CLI credentials through its secure prompts/storage, not source code or shell command arguments. Do not run `db reset` on a hosted/shared project. Do not edit an already-applied migration; add a new versioned migration for later changes.

These commands follow the [Supabase CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows) and [migration guidance](https://supabase.com/docs/guides/deployment/database-migrations). Applying the migration does not deploy the browser/server.

Put the public project URL/key in both ignored `.env` files. Put the dedicated server secret (or legacy service-role key) **only** in `apps/server/.env` as `SUPABASE_SERVER_KEY`. Restart both local processes. The secret is used only for `ng_server_tick`; user-facing room authorization uses the public key plus the verified player's token.

## Tables and ownership

| Schema/table | Role |
| --- | --- |
| `public.ng_rooms` | Host membership, lifecycle, revision, expiry and current match reference |
| `public.ng_room_members` | Stable membership/player ID, Auth identity, slot, display name, readiness and heartbeat |
| `ng_private.codes` | Unique 12-hex-character room codes derived from 48 random UUID bits |
| `ng_private.matches` | Frozen roster, requesting host, revision, runtime owner and authoritative start timestamp |
| `ng_private.requests` | Per-user request deduplication and parameter conflict checks |
| `ng_private.limits` | 12 create/join attempts per authenticated identity per minute, including failed guesses |
| `ng_private.runtime` | Singleton game-server ownership with a 10-second renewable lease |

Only `public` application tables are exposed. **Do not add `ng_private` to exposed API schemas.** Its membership helper is explicitly callable for RLS; operational tables and other helper functions have no browser privileges.

Browser table access is SELECT only, protected by active membership RLS. Direct INSERT/UPDATE/DELETE are denied. Client mutations use the following authenticated-only RPCs; none accept a caller/host/user ID:

- `ng_create_room(p_request_id,p_name)`
- `ng_join_room(p_request_id,p_code,p_name)`
- `ng_get_room(p_room_id)` (null restores the caller's existing room)
- `ng_set_ready(p_request_id,p_room_id,p_ready,p_revision)`
- `ng_leave_room(p_request_id,p_room_id)`
- `ng_request_start(p_request_id,p_room_id,p_revision)`
- `ng_return_lobby(p_request_id,p_room_id,p_revision)`

`ng_server_tick(p_instance_id,p_connected_members)` is granted only to `service_role`. A modern server secret key reaches that operational role through Supabase. It reconciles membership/expiry, independently verifies pending starts, issues the start timestamp, maintains ownership and returns private server roster data. Browser callers cannot execute it.

RPCs run transactionally with an empty search path, fully qualified relations, explicit `auth.uid()` checks and deliberate execution grants. Browser command retries hold the same request ID; changing its parameters is rejected. Successful duplicate requests return a fresh authorized snapshot, not cached stale state. User advisory locks serialize duplicate membership requests; room-row locks serialize joins and roster/start changes. Unique user/room/slot constraints independently enforce membership and four-player capacity.

## Lifecycle and recovery

The host request creates one server-issued pending match: `LOBBY → STARTING`. The game server rechecks the current host against the original requester, exact roster/revision, two-to-four membership and everyone-ready state, then commits `IN_MATCH` and its timestamp. A changed pending roster resets to lobby with readiness cleared.

An active match admits only frozen roster members whose current membership remains valid. Host departure transfers ownership deterministically by join time then membership ID. This does not transfer simulation authority. The host's Return to Lobby control ends the temporary movement session and resets everyone, without implementing results.

Browser polling every two seconds renews membership. Verified movement sockets also renew existing membership through the server; they cannot recreate revoked/stale members. No heartbeat for 30 seconds removes membership. Socket position memory has a separate 15-second grace. Removing a member or deleting/expiring a room rejects new socket admission immediately and disconnects existing sockets at the next successful one-second server reconciliation.

Rooms expire two hours after creation. Empty rooms are removed immediately. Server maintenance removes expired rooms and old request/rate records; it runs only while the server is available. Failed authority sync closes room sockets and neutralizes movement. A replacement instance must wait out the previous lease and then aborts old in-memory matches with a clear lobby error. Use one game-server replica only.

## Live verification checklist

After migration, inspect RLS and execution grants in the dedicated SQL editor:

```sql
select relname, relrowsecurity from pg_class
where oid in ('public.ng_rooms'::regclass,'public.ng_room_members'::regclass);

select
  has_table_privilege('authenticated','public.ng_rooms','INSERT') as browser_insert,
  has_table_privilege('authenticated','public.ng_rooms','UPDATE') as browser_update,
  has_table_privilege('authenticated','public.ng_room_members','DELETE') as browser_delete,
  has_function_privilege('anon','public.ng_create_room(uuid,text)','EXECUTE') as anon_create,
  has_function_privilege('authenticated','public.ng_server_tick(uuid,uuid[])','EXECUTE') as browser_operational,
  has_function_privilege('service_role','public.ng_server_tick(uuid,uuid[])','EXECUTE') as server_operational;
```

Both RLS values must be true. All browser-write/anon/operational booleans must be false; `server_operational` must be true. Also inspect table policies and API-exposed schemas. The SQL editor's owner role bypasses RLS; use actual anonymous-signed-in browser tokens to verify outsider reads and writes through the Data API.

Follow README's two-client flow using real Supabase anonymous signup. Check that invalid/expired tokens fail server admission, guests cannot start, an outsider cannot read the room, direct writes fail, fifth-player joins fail, and joining after start fails. Use a separate test room with three members and two isolated client identities to contend for the final slot on the live project; exactly one must succeed. Record errors/results without logging tokens.

## Local test limits

`pnpm test` executes the full migration and real PostgreSQL RLS/function logic via PGlite, with fixture Auth schemas and roles. It does not replace production Supabase Auth/PostgREST verification. PGlite serializes database execution, so simultaneous caller promises exercise conflicting requests but do not prove multi-connection MVCC locking behavior. Native/live Postgres contention remains a required pre-release check. Browser tests use a test-only Auth and HTTP API fixture backed by the same migration.

## Phase 3A database impact

The user confirms this migration is applied to the dedicated project and Phase 2 live acceptance passed. Phase 3A adds no migration or grant/RLS changes. Active cores, scores, combos and collection events remain server memory owned by the existing match/runtime lease. No browser gameplay writes or extra RPC permissions are introduced.
