# NEON GRID: CYBER HEIST

Phase 1: an authoritative multiplayer movement proof, not the full game.

React/TypeScript/Vite renders a temporary Canvas 2D arena. A separate persistent TypeScript WebSocket server validates Supabase Auth sessions and runs the movement simulation. No other game's code, backend, database, or credentials are used.

## Requirements

- Node 24.18 or later in the Node 24 release line, with `node` available on PATH.
- pnpm 11.19.0 (the version pinned in `packageManager`).
- A dedicated Supabase project with anonymous sign-ins enabled in Authentication settings. The frontend silently creates an anonymous session; players do not enter account credentials.
- If CAPTCHA is mandatory on the project, anonymous sign-in needs a CAPTCHA integration that is outside this phase. Use a dedicated development project with compatible settings for this proof; do not weaken a shared production project.

## Local setup

From this repository's root:

```sh
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
cp apps/server/.env.example apps/server/.env
```

Edit those two ignored `.env` files with the dedicated project's public configuration. Never add service-role or secret keys. No privileged key is required for Phase 1.

| File | Variable | Purpose |
| --- | --- | --- |
| `apps/web/.env` | `VITE_SUPABASE_URL` | Supabase project URL |
| `apps/web/.env` | `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable key (legacy public anon key also accepted) |
| `apps/web/.env` | `VITE_GAME_SERVER_URL` | `ws://127.0.0.1:8787/ws` locally |
| `apps/server/.env` | `SUPABASE_URL` | Same Supabase project URL |
| `apps/server/.env` | `SUPABASE_PUBLISHABLE_KEY` | Same public key; used for Auth `getUser(token)` |
| `apps/server/.env` | `HOST` | `127.0.0.1` locally; explicit binding for later hosting |
| `apps/server/.env` | `PORT` | `8787` locally |
| `apps/server/.env` | `ALLOWED_ORIGINS` | Comma-separated exact browser origins, no trailing slashes; defaults shown in example |

`VITE_` variables become public build output. Environment examples contain placeholders only. Restart development processes after changing configuration.

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. The game server's health endpoint is `http://127.0.0.1:8787/health`.

To run each application separately:

```sh
pnpm --filter @neon/server dev
pnpm --filter @neon/web dev
```

To verify and build:

```sh
pnpm typecheck
pnpm test
pnpm build
```

The browser build is `apps/web/dist/`; the bundled server entry is `apps/server/dist/index.js`. `pnpm start` runs that server using its `.env`. `pnpm --filter @neon/web preview` serves the browser build locally; add its exact origin to `ALLOWED_ORIGINS` and rebuild the browser with the intended configuration first.

## Two-browser manual proof

1. Start the local apps with the actual dedicated Supabase configuration.
2. Open `http://127.0.0.1:5173` in a normal browser window and in a separate private window or another browser profile. Two tabs copied from one another can inherit session storage; isolated windows/profiles avoid sharing identity.
3. Click **Connect player** in both. Both should say **connected** and list two players with distinct full server-issued IDs. Each window should mark its own player `YOU`; the canvas marks it with a white ring.
4. In the first window, hold D, release it, then hold W+A. Observe its movement in both windows. It should stop after release; diagonal speed should match cardinal speed.
5. In the second window, use the arrow keys. Observe movement and release in both windows. Opposing directions cancel.
6. Hold a movement key and change focus away from the page. Movement should stop. Returning focus should not leave a stuck key.
7. Click **Disconnect** in the first window. The second player's identity and movement must remain valid. The first player is dimmed and reserved for 15 seconds.
8. Reconnect the first window within 15 seconds. Its player ID and position should be preserved, with a new socket session ID. After the grace period, a new player identity/spawn is expected.
9. Briefly stop and restart the server. Both pages should show reconnection status and recover automatically. Server restart intentionally resets arena state and player IDs; the Auth identity remains in the tab.

Phase 1 has one shared test arena, with four slots and no room codes. Room creation, readiness, and match lifecycle belong to Phase 2. This phase supplies keyboard controls only, not mobile touch controls.

## Automated browser proof

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

These tests build the production server and launch it locally alongside Vite and a **test-only Auth HTTP fixture**. Two isolated Chromium contexts go through the normal browser Auth SDK and server `getUser` path. The fixture returns unsigned synthetic tokens and exists solely in `tests/`; it is not deployed or imported by the production entry. This proves browser networking/rendering/input against a validated fixture session, not a live Supabase project.

Ports 5173, 9100 and 9101 must be free. Stop normal development servers first. Test traces and screenshots go to ignored `test-results/`.

## Scope and limitations

- No gameplay database writes, migrations, persistent room schema, or Supabase Realtime channels in Phase 1.
- No cores, lasers, abilities, scores, extraction, results, extra arenas, or advanced effects.
- In-memory single-process authority. No horizontal scaling or restart recovery.
- Auth is remotely checked at connection/token renewal; expiration is enforced during play. Immediate revocation detection between checks is not implemented.
- Rendering eases toward server positions; no client prediction or input replay yet. Latency will be noticeable on distant networks.
- Bound catch-up prevents jumps after process stalls, but the simulation slows under overload rather than offering competitive timing guarantees.
- Anonymous Auth signup throttling and test arena capacity apply; no room-specific isolation or deployment-grade perimeter rate limiting yet.
- Socket-origin checks prevent unintended browser origins, but are not a substitute for authentication.
- Only local automated Chromium testing is included; physical devices, other browsers, and a live Supabase project require separate verification.

See `docs/architecture.md` for protocol/security details and `docs/hosting.md` for the read-only mission/hosting investigation. No production deployment was performed.
