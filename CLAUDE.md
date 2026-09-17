# Dove

Self-hosted email relay with webhook delivery, templates, recipients, quotas and logs.
Profile: ts-worker-web.
Direction: [README.md](README.md); numbered documents under `docs/archive/` describe older implementations. Frameworks must not rewrite this file.

## Sources of Truth

This file is the contract; hooks, CI and configuration enforce it. Raise weaker enforcement instead of lowering this contract.

| Fact | Where |
|---|---|
| Human docs | [README.md](README.md), [CHANGELOG.md](CHANGELOG.md) |
| Version | `package.json` and `src/server/lib/version.ts` `APP_VERSION`, synchronized for release |
| Enforcement | `.husky/`, CI/release workflows, `vitest.config.ts`, `scripts/` |
| Local secrets | Ignored `.env.local` / `.env.test`; CI creates safe placeholders with `scripts/setup-ci-env.ts` |
| Machine rules / accidents | Global `AGENTS.md` and `rules/`; [Retrospective.md](Retrospective.md) |

## Project Invariants

- Dashboard auth uses Cloudflare Access JWT validation with `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and JWKS. Localhost / `DEV_MODE=true` uses `DEV_USER`; keep that bypass away from production. Webhooks require Bearer auth. There are no KV sessions or Google OAuth flow.
- Default D1 `dove-db` has `remote = true`: ordinary `bun dev` can use production data. Never migrate, truncate or run automated fixtures against that binding from a laptop.
- L2/L3 select the local `test` configuration and `.env.test`; `dove-db-test` is a local binding name, not a requirement to provision a remote database. Never deploy remote `-test` infrastructure.
- Both `EMAIL_DRY_RUN=true` and `RESEND_DRY_RUN=true` are required in tests, with `DEV_MODE=true`. No test may send real mail or use a real provider credential.
- Preserve server/shared coverage at 99% statements/functions/lines and 96% branches. Client rendering is covered by L3; business logic must not disappear into excluded UI code.
- CD owns deployment through `release.yml`; do not deploy from a laptop. Inspect variable names and ignored-file configuration paths when changing ports/auth, without printing secret values.

## Stack / Layout

| Component | Choice |
|---|---|
| Runtime / install | TypeScript 7 strict with exact optional properties, Bun; CI/CD Bun 1.3.11 |
| Application | Hono Cloudflare Worker, Vite 8 / React 19 SPA, D1, `EMAIL` binding and Resend |
| Static / tests | TypeScript, Biome, Vitest, local HTTP and Playwright Chromium |
| `src/server/`, `src/lib/` | Access, webhook/providers, routes/data and shared email/types |
| `src/client/`, `e2e/{api,bdd}/` | Dashboard and API/browser journeys |

## Commands

Run from the root. Generate the ignored test configuration only when absent; it supplies loopback URLs and fake keys. Build assets before HTTP/browser tests. Chromium, Gitleaks and OSV Scanner are prerequisites for the relevant gates.

```bash
bun install --frozen-lockfile
bun run scripts/setup-ci-env.ts
bun run typecheck
bun run lint
bun run build
bun run test:coverage
bun run test:e2e:api
bun run test:e2e:bdd
bun run gate:security
```

Test configuration needs `D1_WORKER_URL`, `D1_WORKER_API_KEY`, `EMAIL_DRY_RUN`, `RESEND_DRY_RUN`, `DEV_MODE`, `RESEND_API_KEY` and `RESEND_FROM_DOMAIN`. Use local placeholders and unset production Cloudflare credentials; never copy `.env.local` into the test file. The setup script does not replace an existing file: verify its local-only configuration first.

## Verification

6DQ = L1/L2/L3 + G1/G2 + D1. Status: `enforced`, `planned`, `manual`, `N/A`.

| Dimension | Required proof | Status | Current enforcement / gap |
|---|---|---|---|
| L1 logic | Statements/functions/lines ≥99%, branches ≥96%; no `.skip` / `.only` | planned | Commit/CI enforce the stronger four-metric thresholds on server/shared code; complete skip/focus enforcement is missing |
| L2 API | Real local HTTP over 100% of endpoint/method combinations | planned | Push/CI run `scripts/run-e2e.ts`; static route mapping does not prove every behavior/method assertion |
| L3 UI | Critical dashboard workflows in Chromium with dry-run delivery | enforced | CI runs Playwright; page mapping is additional structural evidence |
| G1 static | Strict types and check-only lint, zero errors/warnings | enforced | Commit typecheck/staged Biome; CI static checks |
| G2 security | Dependency and secret scans; missing scanner fails | enforced | Commit staged Gitleaks, push OSV, CI shared scanners; local push does not independently scan its commit range for secrets |
| D1 isolation | Per-run local stores, guards before fixtures/reset/cleanup and verified marker | planned | Test config uses local SQLite but no `--persist-to`; URL guard still accepts remote names containing test, and marker validation occurs after schema writes |
| Build | Actual Vite assets in `dist/client` | enforced | CI prepare command and CD build |
| Docs / release | Public behavior, schema and synchronized version reviewed | manual | README/changelog and maintainer release checks |

| Hook | Current behavior | Required follow-up |
|---|---|---|
| pre-commit | Working-tree typecheck, staged lint/secrets, route/page maps and coverage in parallel | G1+L1 on index snapshot, <30s |
| pre-push | Local API E2E and dependency scan in parallel | Full L2+G2 on stdin push refs, <3min |

Install restores Husky. Hooks are check-only; never use `--no-verify` on commits or branch pushes. CI pins `base-ci/quality.yml` at `ad43150de3a2be2fa464b5cd2f921dc4fa9f8f0f` and runs L1/G1/G2/L2/L3.

## Resources / Isolation

| Lane | Port / store | Boundary |
|---|---|---|
| Daily dev | 7034, default `dove-db` | Remote production binding; never an automated test target |
| L2 | 17034, `--env test --env-file .env.test` | Local SQLite; default persistence is shared across runs |
| L3 | 27034, same local test environment | Browser server may be reused outside CI; separate per-run persistence remains required |

Required harnesses reject remote bindings/URLs and production credential fallback, allocate fresh local state separate from development and the other lane, and assert test context before mutation. Initialize `_test_marker(key,value)` with `env=test` in verified local state, then check it before reset/cleanup. The current marker value `e2e-test-db` and post-initialization check do not satisfy that whole contract.

## Operations / Release

Authorized maintainers use `bun run release` from `main` (patch default). It synchronizes package version, `APP_VERSION` and changelog, pushes main, waits for CI, then pushes the version tag. GitHub write access, `gh` and the production environment are required.
Tag CD has no independent wait; preserve the script's CI-before-tag ordering. Verify `GET https://dove.hexly.ai/api/live` after an intended deployment and keep production secrets in Cloudflare/GitHub.

## Retrospective

Narratives remain in [Retrospective.md](Retrospective.md); keep only recurring rules here, cross-project lessons in global rules/nmem and deterministic requirements in hooks/tests.
