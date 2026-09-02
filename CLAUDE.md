# Dove

Self-hosted email relay on Cloudflare Workers: webhook send, templates, recipients, quotas, logs. Live: `https://dove.hexly.ai`.
Profile: ts-worker-web
Direction: [README.md](README.md). Numbered docs in `docs/archive/` are stale. Frameworks must not rewrite this file.

## Sources of Truth

This file is the **contract**. Hooks, CI, and config are **enforcement**. If they disagree, raise enforcement; never lower this file.

| Fact | Where |
|---|---|
| Agent handbook | this file |
| Human docs | README.md, CHANGELOG.md |
| Version | `package.json` `"version"` + `src/server/lib/version.ts` `APP_VERSION` |
| Enforcement | `.husky/*`, `.github/workflows/{ci,release}.yml`, `vitest.config.ts`, `scripts/*` |
| Machine rules | global `AGENTS.md`, `rules/git-commit.md` |
| Accidents | [Retrospective.md](Retrospective.md) |
| Env files | `.env.local` / `.env.test` gitignored. CI writes `.env.test` via `scripts/setup-ci-env.ts`. Secrets: `wrangler secret put` |

## Project Invariants

- Dashboard auth is Cloudflare Access JWT (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` + JWKS). Localhost / `DEV_MODE=true` uses `DEV_USER`. Webhook is Bearer. No KV sessions. No Google OAuth.
- Default D1 `dove-db` has `remote = true` — `bun dev` talks to prod. Never migrate or truncate it from a laptop.
- L2/L3 use `--env test` (`dove-db-test`, no `remote`) + `.env.test`. No `--persist-to`. Never default-env remote `dove-db`.
- Coverage is server + shared lib only (`vitest.config.ts` include). Client is L3, not the 99% denominator.
- Do not laptop-`wrangler deploy`. CD is `release.yml`.

## Stack / Layout

| Component | Choice |
|---|---|
| Language | TypeScript 7 strict (`exactOptionalPropertyTypes`) |
| Package manager | Bun (CI/CD pin 1.3.11; no `packageManager` field) |
| Runtime | CF Workers (Hono) + Vite 8 React 19 SPA |
| Lint | Biome `check --error-on-warnings`; lint-staged on pre-commit. No `noSkippedTests` |
| Tests | Vitest L1 99/99/96/99; L2 `scripts/run-e2e.ts`; L3 Playwright |
| Data | D1 `dove-db` / `dove-db-test`; Send Email binding `EMAIL` |

```
src/server/   Hono, D1, Access, webhook, providers
src/client/   Vite SPA (no viewmodels)
src/lib/      shared types + email
e2e/{api,bdd} L2 / L3
```

## Commands

```bash
bun dev
bun run typecheck
bun run lint
bun run build
bun run test:coverage
bun run test:e2e:api
bun run test:e2e:bdd
bun run release
```

## Verification

Status: `enforced` | `planned` | `manual` | `N/A`. `enforced` Evidence = hook/CI/config/script.

Org gaps: index-snapshot pre-commit; stdin-range pre-push; `.skip`/`.only`; L2/L3 `--persist-to`.

Today: pre-commit typecheck / lint-staged / gitleaks `--staged` / `gate:routes` / `gate:pages` / `test:coverage` on the working tree. pre-push L2 ‖ osv. CI bun-quality `@aec4adc1a817c56790d1698329ef9398a15a754a` (v2026.5, bun 1.3.11): build, coverage, typecheck, G2, L2, L3 chromium.

| Change | Proof | Status | Evidence |
|---|---|---|---|
| Logic | L1 vitest 99/99/96/99 on server+lib | enforced | pre-commit `test:coverage`; `vitest.config.ts`; CI |
| API L2 | real HTTP `--env test` :17034 | enforced | pre-push `test:e2e:api`; CI; `gate:routes` |
| UI L3 | Playwright Chromium :27034 | enforced | CI `test:e2e:bdd` (not pre-push); `gate:pages` |
| Types / lint | tsc + Biome 0 warning | enforced | pre-commit typecheck + lint-staged; CI typecheck |
| G2 secrets | gitleaks | enforced | pre-commit `--staged`; CI bun-quality |
| G2 deps | osv `bun.lock` | enforced | pre-push `gate:deps`; CI |
| Bundler | Vite → `dist/client` | enforced | CI pre-command `build`; CD `release.yml` |
| Docs | README if public contract changes | manual | human review |
| Release | tag == package.json; CD deploy | enforced | `scripts/release.ts`; `release.yml` |

| Hook | Org bar | Status | Evidence |
|---|---|---|---|
| pre-commit | index snapshot | planned | — |
| pre-push | stdin ref range | planned | — |

`--no-verify` forbidden on commits and branch pushes. Tag-only may skip.

## Resources / Isolation

| Purpose | Port / resource | Isolation |
|---|---|---|
| Dev | 7034 `http://localhost:7034` | remote D1 `dove-db` (`remote = true`) |
| L2 | 17034 | `--env test` local SQLite `dove-db-test`; `.env.test` |
| L3 | 27034 | `--env test` same; Playwright; `DEV_MODE` / dry-run |

## Operations / Release

- Entry: `bun run release` from `main` (patch default). Syncs `package.json` + `APP_VERSION` + CHANGELOG, push `main`, then push tag. Who: GitHub write + `production` Environment + `gh`.
- Tag push deploys immediately (no CI wait). `main` CD waits CI-green. Do not laptop-`wrangler deploy`.
- Live-check: `GET https://dove.hexly.ai/api/live`.

## Retrospective

| Kind | Where |
|---|---|
| Accident narrative | [Retrospective.md](Retrospective.md) |
| Recurring project rule | one line here (cap ~10) |
| Checkable rule | hook or test |

- Default D1 is remote prod. E2E stays `--env test`.
- When changing ports/URLs/keys, grep gitignored files too.
