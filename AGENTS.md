# Dove

Self-hosted email relay with webhook delivery, templates, recipients, quotas and logs.
Profile: ts-worker-web.
Direction: [README.md](README.md); numbered documents under `docs/archive/` describe older implementations. Frameworks must not rewrite this file.

## Scope and instruction sources

- This file is the only project handbook; nested files do not compete with it. Do not create a `CLAUDE.md` alias or copy.
- This file is the contract; hooks, CI and configuration enforce it. Raise weaker enforcement instead of lowering this contract.
- Human docs: [README.md](README.md) and [CHANGELOG.md](CHANGELOG.md). Version: `package.json` and `src/server/lib/version.ts` `APP_VERSION`, synchronized for release. Enforcement: `.husky/`, CI/release workflows, `vitest.config.mts`, `scripts/`. Local secrets: ignored `.env.local` / `.env.test`; CI creates safe placeholders with `scripts/setup-ci-env.ts`. Machine rules/accidents: global `AGENTS.md` and `rules/`; [Retrospective.md](Retrospective.md).

## Project invariants

- Dashboard auth uses Cloudflare Access JWT validation with `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and JWKS. Localhost / `DEV_MODE=true` uses `DEV_USER`; keep that bypass away from production. Webhooks require Bearer auth. There are no KV sessions or Google OAuth flow.
- Default D1 `dove-db` has `remote = true`: ordinary `bun dev` can use production data. Never migrate, truncate or run automated fixtures against that binding from a laptop.
- L2/L3 select the local `test` configuration and `.env.test`; `dove-db-test` is a local binding name, not a requirement to provision a remote database. Never deploy remote `-test` infrastructure.
- Both `EMAIL_DRY_RUN=true` and `RESEND_DRY_RUN=true` are required in tests, with `DEV_MODE=true`. No test may send real mail or use a real provider credential.
- Preserve server/shared coverage at 99% statements/functions/lines and 96% branches. Client rendering is covered by L3; business logic must not disappear into excluded UI code.
- CD owns deployment through `release.yml`; do not deploy from a laptop. Inspect variable names and ignored-file configuration paths when changing ports/auth, without printing secret values.

## Setup and commands

TypeScript 7 strict with exact optional properties, Bun (CI/CD Bun 1.3.11); Hono Cloudflare Worker, Vite 8 / React 19 SPA, D1, `EMAIL` binding and Resend; TypeScript, Biome, Vitest, local HTTP and Playwright Chromium. `src/server/` and `src/lib/` hold Access, webhook/providers, routes/data and shared email/types; `src/client/` and `e2e/{api,bdd}/` hold the dashboard and API/browser journeys.

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

## Testing and quality contract

Quality follows System1 v1.3.0 Native Mode (`nocoo/base-ci v2026.15`) in `.github/workflows/quality-slots.yml` and `.github/workflows/ci.yml`. Statuses: `enforced`, `planned`, `manual`, `N/A`.

| Slot              | Status   | Evidence                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------ |
| `S1` Types        | enforced | `bun run typecheck` (pre-commit + CI)                                          |
| `S2` Lint         | enforced | `bun run lint` (Biome, pre-commit + CI)                                        |
| `S3` Workflow     | enforced | SHA-pinned workflow action check in CI                                         |
| `G1` Secrets      | enforced | `gitleaks` (`.gitleaks.toml`) in pre-commit + CI                               |
| `G2` Dependencies | enforced | `osv-scanner` (`osv-scanner.toml`, `bun.lock`) in pre-push + CI                |
| `B1` Build        | enforced | `bun run build` in CI                                                          |
| `L1` Unit         | enforced | `vitest --coverage` (≥99% stmts/funcs/lines, ≥96% branches) in pre-commit + CI |
| `L2` Runtime      | N/A      | No `@cloudflare/vitest-pool-workers` suite                                     |
| `L3` Integration  | enforced | `bun run test:e2e:api` in pre-push + CI                                        |
| `L4` E2E          | enforced | `bun run test:e2e:bdd` (Playwright Chromium) in CI                             |
| `P1` Package      | N/A      | Private repo, not published to npm                                             |
| `Z1` Gate         | enforced | `quality / Z1: Gate` required status check on `main`                           |

| Hook       | Current behavior                                                                                | Required follow-up                                     |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| pre-commit | Index snapshot: gitleaks + parallel typecheck, Biome, route/page maps and coverage (\<30s warm) | Maintain snapshot enforcement and measured warm timing |
| pre-push   | Local API E2E and dependency scan in parallel                                                   | Full L2+G2 on stdin push refs, <3min                   |

Install restores Husky. Hooks are check-only; never use `--no-verify` on commits or branch pushes.

## Resources and isolation

| Lane      | Port / store                                                       | Boundary                                                                               |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Daily dev | 7034, default `dove-db`                                            | Remote production binding; never an automated test target                              |
| L2        | Allocated loopback port, owned temporary config and `--persist-to` | Fresh local SQLite, fake credentials and both dry-run flags                            |
| L3        | 27034, same local test environment                                 | Browser server may be reused outside CI; separate per-run persistence remains required |

Required harnesses reject remote bindings/URLs and production credential fallback, allocate fresh local state separate from development and the other lane, and assert test context before mutation. Initialize `_test_marker(key,value)` with `env=test` in verified local state, then check it before reset/cleanup. L2 bootstraps `env=test` and a random `run_id` in owned local state before read-only HTTP verification and schema initialization. L3 remains a separate isolation gap.

## Operations / release

Authorized maintainers use `bun run release` from `main` (patch default). It synchronizes package version, `APP_VERSION` and changelog, pushes main, waits for CI, then pushes the version tag. GitHub write access, `gh` and the production environment are required.
Tag CD has no independent wait; preserve the script's CI-before-tag ordering. Verify `GET https://dove.hexly.ai/api/live` after an intended deployment and keep production secrets in Cloudflare/GitHub.

## Retrospective

Narratives remain in [Retrospective.md](Retrospective.md); keep only recurring rules here, cross-project lessons in global rules/nmem and deterministic requirements in hooks/tests.
