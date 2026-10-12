> Current transport: HTTP-only gameplay. Follow [the migration report](http-only-migration-report.md); WebSocket instructions below are historical and superseded. Database fencing, one-replica limits, and secret boundaries remain applicable.

# Mission and hosting investigation

Read-only investigation began October 9, 2026. No deployment, account connection or infrastructure change was made.

## Available evidence

- The [public Handshake mission overview](https://joinhandshake.com/learn/create-a-multiplayer-game-8d7d59b5/) asks for a reusable public game URL, room-code joining, phone/laptop access and no visible login or installation.
- The linked [official contest rules](https://go.joinhandshake.com/rs/390-ZTF-353/images/%5BAI_Skills_Studio_Challenge%5D_Contest_Official_Rules.pdf?version=0) do not specify an exclusive hosting vendor.
- The [detailed mission](https://app.joinhandshake.com/learn/create-a-multiplayer-game-8d7d59b5) redirects to login; its detailed hosting instructions were not available.
- The parent directory's `multiplayer_game_portfolio_plan.md` proposes Vercel for public frontends and Supabase for multiplayer coordination. This planning document is not an official mission rule. No sibling game's backend or repository was reused.

There is no confirmed material hosting restriction blocking the local architecture. Detailed mission restrictions remain unverified, and must be checked before deployment.

## Proposed persistent host

Use a single **Render Web Service** for the Node/TypeScript game server and separate static hosting (Vercel, Netlify or Render Static Site) for the Vite browser build. [Render documents inbound WebSocket support](https://render.com/docs/websocket) and secure `wss://` connections. This is a hosting proposal only; no provider resource exists for this project yet.

For later hosting: bind HOST to `0.0.0.0`, accept the provider's PORT, configure exact ALLOWED_ORIGINS, and build the frontend with the server's secure WebSocket URL. Use a persistent instance appropriate to uninterrupted play and keep one replica until room routing/leases exist. Provider restarts still interrupt connections and reset this phase's in-memory arena; reconnect handling is included.

Anonymous Supabase Auth is silent, so it does not require a visible player account flow. Room codes are now implemented; touch movement remains pending.

Phase 4 adds repository-root `vercel.json` and `render.yaml` templates for a Vercel static client and one persistent Render server. No service has been provisioned or deployment verified. See [deployment runbook](deployment.md) for prerequisites, singleton lease handoff, readiness checks and the production acceptance gate.
