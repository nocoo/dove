# Dove

Self-hosted email relay (webhooks, templates, recipients, quotas, logs) on Hono Cloudflare Worker + Vite 8 / React 19 SPA with D1, `EMAIL` binding, and Resend (`ts-worker-web`).
Layout: `src/server/` & `src/lib/` (Access, webhooks, providers, routes, shared email/types); `src/client/` & `e2e/{api,bdd}/` (dashboard, API/browser suites).
Docs: [README.md](README.md) · [Development & Deploy](docs/04-development.md) · [CHANGELOG.md](CHANGELOG.md) · [Retrospective](Retrospective.md) (`docs/archive/` holds older specs).

## Commands

Run from root with Bun (CI/CD 1.3.11) and TypeScript 7 strict (`exactOptionalPropertyTypes`). Gate prerequisites: Playwright Chromium, `gitleaks`, `osv-scanner`.

```sh
bun install --frozen-lockfile      # restores .husky/ hooks
bun run scripts/setup-ci-env.ts    # creates .env.test only when absent
bun run typecheck                  # S1
bun run lint                       # S2 (Biome check-only, 0 warnings)
bun run build                      # B1 (required before API/BDD E2E)
bun run test:coverage              # L1 (>=99% stmts/funcs/lines, >=96% branches)
bun run test:e2e:api               # L3 isolated local API integration
bun run test:e2e:bdd               # L4 Playwright Chromium E2E
bun run gate:security              # G1 + G2 (gitleaks + osv-scanner)
```

`.env.test` needs loopback `D1_WORKER_URL`, `D1_WORKER_API_KEY`, `EMAIL_DRY_RUN=true`, `RESEND_DRY_RUN=true`, `DEV_MODE=true`, `RESEND_API_KEY`, and `RESEND_FROM_DOMAIN`. Never copy `.env.local` into `.env.test`; `scripts/setup-ci-env.ts` never overwrites an existing file, so verify local-only values first.

## Invariants

- **Auth**: Dashboard uses CF Access JWT (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, JWKS); localhost/`DEV_MODE=true` uses `DEV_USER` (never in prod). Webhooks use Bearer auth; no KV sessions or Google OAuth.
- **Production D1**: Default `dove-db` has `remote = true`, so plain `bun dev` hits production data. Never migrate, truncate, or run automated fixtures against that binding from a laptop.
- **Local test DB**: `L3`/`L4` select `--env test` and `.env.test`; `dove-db-test` is a local binding only—never provision or deploy remote `-test` infrastructure.
- **Dry-run & creds**: Tests require `EMAIL_DRY_RUN=true`, `RESEND_DRY_RUN=true`, `DEV_MODE=true`, documented placeholders, and unset `CLOUDFLARE_*`/`CF_*` env; never send real mail or use real provider keys.
- **Coverage boundary**: Keep `src/server/` and `src/lib/` >=99% stmts/funcs/lines and >=96% branches (`vitest.config.mts`). UI (`src/client/`) is covered by `L4`; never hide business logic in excluded UI code.
- **Version & env**: Sync `package.json` and `src/server/lib/version.ts` (`APP_VERSION`) on release. When changing ports/URLs/auth, inspect ignored `.env.local`/`.env.test` paths without printing secrets.
- **CD ownership**: `.github/workflows/pipeline.yml` (`deploy` job, `D1`–`D5` via `deploy-worker.yml` on `main` push after `quality / Z1: Gate` passes, or `workflow_dispatch` with `deploy=true`) owns production deploys, reusing `b1-build` (`dist/client`) without rebuilding and verifying `https://dove.hexly.ai/api/live`—never `wrangler deploy` from a laptop; keep prod secrets in Cloudflare/GitHub.
- **Release flow**: Authorized `bun run release` on `main` (patch default; needs `gh`, write access, `production` env) syncs version/changelog and pushes `main` (`pipeline.yml` runs quality + Worker deploy in one pipeline).

## Quality & Local Gates

Follows `system1-quality`; CI slots and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` via `.github/workflows/pipeline.yml` (`quality / Z1: Gate` required on `main`). Statuses: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` is `N/A` (no `@cloudflare/vitest-pool-workers` suite); `P1 Package` runs `wrangler deploy --env="" --dry-run` reusing `B1` (`enforced`); `L3` and `L4` reuse `B1` (`dist/client/`); `L4` per-run persistence isolation is `planned`.
- **Local hooks**: `bun install` restores check-only `.husky/` hooks; never bypass with `--no-verify`.
- **pre-commit** (`enforced`): checks staged index snapshot via `gitleaks` (`G1`) + parallel `typecheck` (`S1`), `lint` (`S2`), `gate:routes`, `gate:pages`, and `test:coverage` (`L1`, `<30s` warm target).
- **pre-push** (`enforced` for `L3` + `G2`): runs `test:e2e:api` and `gate:deps` (`osv-scanner`) in parallel; stdin push-ref isolation (`<3min` target) is `planned`.

## Resources & Isolation

| Lane      | Endpoint / State                                      | Boundary                                                                            |
| --------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Daily dev | `127.0.0.1:7034`, default `dove-db`                   | Remote production binding (`remote = true`); never an automated test target         |
| `L3` API  | Ephemeral loopback port, temp config + `--persist-to` | Fresh local SQLite, fake creds, both dry-run flags; verifies `_test_marker`         |
| `L4` BDD  | `127.0.0.1:27034`, `--env test` + `.env.test`         | Reuses local server outside CI; per-run persistence isolation `planned`             |
| Prod      | `https://dove.hexly.ai`                               | Read-only `/api/live` checks unless release/deploy via `pipeline.yml` is authorized |

Test harnesses must reject remote bindings/URLs and prod credential fallback, allocate isolated local state, and verify `_test_marker(key,value)` (`env=test` + random `run_id` in `L3`) read-only before schema init or cleanup.

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and deterministic checks to hooks or tests.
