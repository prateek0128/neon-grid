# Deployment architecture decision

The Vercel Services proposal is superseded by the confirmed separate architecture:

- Vercel deploys only the React/Vite client from `apps/web`, using repository-root `vercel.json`.
- The existing Render service remains the single persistent authoritative WebSocket server.
- No Vercel multi-service routing, internal service bindings or serverless game-server adapter is required.
- `VITE_GAME_SERVER_URL` must be the existing Render public secure WebSocket URL ending in `/ws`.

See [deployment runbook](deployment.md) for frontend environment configuration and validation. The actual Render public URL has not been provided or found in repository configuration; do not invent it. No deployment or commit has been performed for this decision.
