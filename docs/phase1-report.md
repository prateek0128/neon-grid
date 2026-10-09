# Phase 1 verification report

Verified locally October 10, 2026 (Asia/Kolkata). Phase 2 was not started. No production deployment, migrations, privileged credentials or gameplay database writes.

## Results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed, with esbuild's required build script explicitly allowed |
| `pnpm typecheck` | Passed |
| `pnpm test` | 40 tests passed across four files |
| `pnpm build` | Browser and bundled server passed |
| Chromium two-browser test | Passed with two isolated browser contexts and distinct player IDs |
| Chromium blur/retry test | Passed with a real native socket close and automatic reconnect |
| Visual inspection | Captured arena view inspected; two players and identity/status UI render correctly |
| Live Supabase project | Not verified; no dedicated project configuration supplied |
| Physical-device/other-browser testing | Not performed |

The automated server/browser tests use a test-only Auth HTTP fixture. The server uses its real Supabase SDK `getUser` verifier against that fixture; its production entry has no authentication bypass. The browser tests run the built production server with the browser development app. Production browser compilation is checked separately.

The original retry test used Chromium's offline setting, which did not close the existing socket. It was corrected to instrument and close the native WebSocket solely inside the test. The corrected test passed. Test screenshot: ignored `test-results/movement-proof.png`, recreated by browser tests.

Tooling: pnpm 11.19.0; verification package scripts used bundled Node 24.19.0. Initial workspace discovery reported Node 24.18.0. Both satisfy the repository's Node 24 engine range.

## Acceptance evidence

- Distinct identity: two browser contexts show different IDs and correctly label their own player.
- Synchronization: movement from each context is observed by the other; server integration tests compare identical player snapshots at the same tick.
- WASD/arrows: both exercised in Chromium and in keyboard-mapping tests.
- Diagonals: browser exercises diagonal intent; unit test verifies equal displacement magnitude to cardinal movement.
- Release/blur: both tested; stale-input timeout also tested at the server.
- Session rejection: unknown/expired tokens, incorrect socket IDs and identity-changing renewal are rejected.
- Validation: strict field/vector/sequence checks, malformed JSON, rate excess and replay are tested.
- Disconnect isolation: remaining player stays connected with its original identity; reconnect within grace retains the departing player ID and issues a fresh session ID.
- Build/install: locked dependencies, explicit dependency build allowance, separate browser/server production outputs.

## Created files

```text
.gitignore
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
vitest.config.ts
playwright.config.ts
README.md
apps/web/package.json
apps/web/.env.example
apps/web/index.html
apps/web/vite.config.ts
apps/web/src/env.d.ts
apps/web/src/main.tsx
apps/web/src/App.tsx
apps/web/src/Arena.tsx
apps/web/src/style.css
apps/web/src/auth.ts
apps/web/src/connection.ts
apps/web/src/keyboard.ts
apps/web/src/keyboard.test.ts
apps/server/package.json
apps/server/.env.example
apps/server/build.mjs
apps/server/src/index.ts
apps/server/src/auth.ts
apps/server/src/server.ts
apps/server/src/server.test.ts
packages/protocol/package.json
packages/protocol/src/index.ts
packages/protocol/src/protocol.test.ts
packages/simulation/package.json
packages/simulation/src/index.ts
packages/simulation/src/simulation.test.ts
tests/auth-fixture.ts
tests/browser-services.ts
tests/browser/movement.spec.ts
docs/architecture.md
docs/hosting.md
docs/phase1-report.md
```

Build output, installed dependencies and test artifacts are ignored. Actual `.env` files were not created. README contains exact configuration and two-browser manual testing instructions.

## Remaining limitations/blockers

No confirmed hosting blocker. Render Web Service is proposed for persistent authority; frontend hosting remains separate. Detailed Handshake mission instructions remain behind login and must be checked before deployment. Dedicated live Supabase public configuration and anonymous sign-in settings are required to complete live Auth verification.

One shared four-player arena; keyboard controls only; no room lobby, prediction, persistent game state, multi-instance authority or server-restart identity recovery. Token revocation is detected at connection/renewal rather than continuously. These limitations are documented in README and belong to later work.
