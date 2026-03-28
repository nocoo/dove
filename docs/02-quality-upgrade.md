# Quality System Upgrade: From Current to Tier S

## Overview

Dove currently sits at **Tier B+** in the 6-dimension quality system. L1 + G1 are solid, but L2 is architecturally mocked (not true HTTP E2E), L3 is unimplemented, D1 test isolation is configured but unused, and G2 has a soft-skip loophole.

This document defines the precise upgrade path to **Tier S** (all 6 dimensions green).

---

## Current State Assessment

| Dimension | Status | Detail |
|-----------|--------|--------|
| **L1** Unit Tests | ✅ Green | 123 tests, 92%+ coverage, pre-commit enforced |
| **G1** Static Analysis | ✅ Green | `tseslint.configs.strict` + `--max-warnings=0` + `tsc strict:true`, pre-commit |
| **L2** API E2E | 🟡 Mocked | 69 tests but D1 fully mocked via `mock.module`, route handlers called in-process (not real HTTP) |
| **G2** Security | 🟡 Soft | osv-scanner + gitleaks run, but silently pass if tools not installed |
| **L3** BDD E2E | 🔴 Missing | Playwright dep installed, script defined, but zero test files / no config / no runner |
| **D1** Test Isolation | 🟡 Configured | `dove-db-test` exists in `wrangler.toml [env.test]`, but no test ever connects to it. No `_test_marker`. |

**Current Tier: B+** (L1 ✅ + G1 ✅, but D1 not exercised → cannot reach A)

---

## Target State

| Dimension | Target | Detail |
|-----------|--------|--------|
| **L1** | ✅ Keep | No changes needed |
| **G1** | ✅ Keep | No changes needed |
| **L2** | ✅ True HTTP | Real HTTP calls to running dev server on port 17046, connecting to `dove-db-test` via **separate test Worker** |
| **G2** | ✅ Hard fail | Remove soft-skip: fail if osv-scanner or gitleaks not installed |
| **L3** | ✅ Playwright | Bypassed-auth app-flow coverage (navigation, CRUD, data rendering) — **not** real Google OAuth |
| **D1** | ✅ Full isolation | `_test_marker` table, separate test Worker deployment, E2E connect to `dove-db-test` |

**Target Tier: S** (6/6 green)

---

## Implementation Steps

### Step 1: Harden G2 — Remove soft-skip loophole ✅

**Files**: `scripts/gate-security.ts`

**Change**: When osv-scanner or gitleaks is not installed, fail hard instead of silently passing.

```diff
- console.warn(`${label}: tool not found — skipping (install for full security checks)`);
- return true;
+ console.error(`${label}: tool not installed. Install it to pass the security gate.`);
+ console.error(`  osv-scanner: https://github.com/google/osv-scanner`);
+ console.error(`  gitleaks: https://github.com/gitleaks/gitleaks`);
+ return false;
```

**Test**: Run `bun run gate:security` — must pass (tools are installed). Temporarily rename a tool binary to verify it now fails.

**Commit**: `fix(G2): fail hard when security tools are not installed`

---

### Step 2: Harden auth bypass — add NODE_ENV production guard ✅

**Files**: `src/proxy.ts`

**Problem**: The current auth bypass at `src/proxy.ts:7` checks only `process.env.E2E_SKIP_AUTH === "true"`. If this env var is accidentally set in production (e.g., copied from a test config), all auth is bypassed. There is no `NODE_ENV` guard.

**Change**:
```diff
- const SKIP_AUTH = process.env.E2E_SKIP_AUTH === "true";
+ const SKIP_AUTH =
+   process.env.E2E_SKIP_AUTH === "true" &&
+   process.env.NODE_ENV !== "production";
```

**Test**: Add a unit test in `src/__tests__/proxy.test.ts` verifying that `SKIP_AUTH` is false when `NODE_ENV=production` even if `E2E_SKIP_AUTH=true`.

**Commit**: `fix: guard E2E auth bypass with NODE_ENV !== production`

---

### Step 3: Deploy separate test Worker + D1 test isolation ✅

**ADR Decision**: **Option A is mandatory** — deploy a separate test Worker instance (`wrangler deploy --env test`). The production Worker has no request-level env switch and we will NOT add one. The client (`src/lib/db/d1-client.ts`) simply reads `D1_WORKER_URL` + `D1_WORKER_API_KEY` from env; pointing those at the test Worker URL is sufficient.

**Files**:
- `worker/wrangler.toml` — Add `[env.test]` route for `dove-test.worker.hexly.ai`
- `src/lib/db/schema.ts` — Export `SCHEMA_SQL` and `PARTIAL_INDEX_SQL` (currently module-private `const`); add `_test_marker` CREATE TABLE to schema
- `scripts/deploy-test-worker.ts` (NEW) — One-shot script: deploy test Worker + replay full schema + seed `_test_marker`
- `scripts/verify-test-db.ts` (NEW) — Script to verify connected DB is the test instance
- `scripts/run-e2e.ts` — Call verify-test-db before running tests

**Schema export change** (`src/lib/db/schema.ts`):
```diff
- const SCHEMA_SQL = `
+ export const SCHEMA_SQL = `
  ...
- const PARTIAL_INDEX_SQL =
+ export const PARTIAL_INDEX_SQL =
```

This allows both `initializeSchema()` (unchanged, same file) and `deploy-test-worker.ts` to share the single source of truth for schema DDL.

**Design**:

The `_test_marker` table contains a single row `(key='env', value='test')`. Before any E2E test run, the runner verifies this marker exists. If it doesn't, the test suite refuses to run — protecting production data.

The marker is seeded via **direct SQL through the test Worker's `/query` endpoint** — the same thin SQL proxy used at runtime. This avoids depending on the app's `POST /api/db/init` route (which is behind the auth gate). The script replays the **full schema** from `src/lib/db/schema.ts` — all tables, all indexes (including the partial unique index for idempotency), then seeds `_test_marker`.

```sql
-- deploy-test-worker.sh replays ALL of SCHEMA_SQL + PARTIAL_INDEX_SQL,
-- then appends _test_marker:
CREATE TABLE IF NOT EXISTS _test_marker (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO _test_marker (key, value) VALUES ('env', 'test');
```

**`scripts/deploy-test-worker.ts`** (TypeScript — can directly import schema constants):
```typescript
// 1. cd worker/ && wrangler deploy --env test
// 2. wrangler secret put API_KEY --env test (interactive, one-time)
// 3. Import SCHEMA_SQL + PARTIAL_INDEX_SQL from src/lib/db/schema.ts
//    Split into individual statements (same logic as initializeSchema())
// 4. Append _test_marker CREATE TABLE + INSERT seed
// 5. Send each statement as POST /query to https://dove-test.worker.hexly.ai
//    using D1_WORKER_URL + D1_WORKER_API_KEY from .env.test
//
// This replays the FULL schema:
//   - 5 CREATE TABLE statements (projects, recipients, templates, send_logs, webhook_logs)
//   - 10 CREATE INDEX statements (covering FK lookups, sort columns)
//   - 1 CREATE UNIQUE INDEX ... WHERE (partial index for idempotency_key)
//   - 1 CREATE TABLE _test_marker + INSERT seed
```

> **Why replay the full schema?** The test DB must be identical to production in structure — including all indexes and the partial unique index on `send_logs(project_id, idempotency_key)`. Seeding only tables would cause idempotency dedup to silently not work in tests, masking real bugs.
>
> **Why not use `POST /api/db/init`?** That route is behind the auth gate (`src/proxy.ts`). Sending SQL directly to the test Worker's `/query` endpoint is simpler, has no auth dependency, and is idempotent (all DDL uses `IF NOT EXISTS`).

**`scripts/verify-test-db.ts`**:
```typescript
// 1. Load .env.test for test Worker credentials
// 2. Inequality check: D1_WORKER_URL (from .env.test) !== D1_WORKER_URL (from .env.local)
//    Refuses to run if test URL === production URL (misconfiguration guard)
// 3. Queries: SELECT value FROM _test_marker WHERE key='env'
//    Exits non-zero if result !== 'test'
```

> **Isolation checklist** (from Cloudflare D1 isolation spec, Variant B: External App):
> - ✅ Separate test Worker deployment (`dove-test.worker.hexly.ai`)
> - ✅ `_test_marker` table with value `'test'`
> - ✅ Inequality check: `D1_WORKER_URL` in `.env.test` ≠ production URL in `.env.local`
> - ✅ `verify-test-db.ts` runs before every E2E test suite

**Commit**: `feat(D1): deploy test Worker and add _test_marker verification`

---

### Step 4: Rewrite L2 — True HTTP E2E against running server ✅

**Files**:
- `scripts/run-e2e.ts` — Rewrite to auto-start/stop dev server on port 17046
- `e2e/api/helpers.ts` — Replace mock infrastructure with real HTTP client
- `e2e/api/*.test.ts` (7 files) — Rewrite to make real HTTP requests
- `.env.test` (NEW) — Test environment variables pointing to `dove-db-test`

**Architecture change**:

```
BEFORE (current):
  test → import route handler → mock D1 → call handler() in-process

AFTER (target):
  run-e2e.ts → spawn `next dev --port 17046` with E2E env
  test → fetch("http://localhost:17046/api/...") → real HTTP → real D1 (test)
  run-e2e.ts → kill server
```

**`.env.test`** (test-only config):
```env
# D1 Worker proxy — separate test Worker instance (NOT production Worker)
# Deployed via: wrangler deploy --env test (see scripts/deploy-test-worker.sh)
D1_WORKER_URL=https://dove-test.worker.hexly.ai
D1_WORKER_API_KEY=<test-worker-api-key>

# Skip auth for E2E (already implemented in src/proxy.ts)
E2E_SKIP_AUTH=true

# Port — do NOT use "bun run dev", use "next dev --port 17046" directly
PORT=17046
```

> **Note**: `D1_WORKER_URL` points to the **test Worker** (`dove-test.worker.hexly.ai`), which is a completely separate Cloudflare Worker deployment bound to `dove-db-test`. No request-level env switching — isolation is at the deployment level.

**`scripts/run-e2e.ts`** rewrite:
1. Load `.env.test` into environment — **hard fail** if file missing or `D1_WORKER_URL` not set (L2 is a required gate for Tier S; missing infrastructure must block push, same as G2)
2. **Inequality check**: assert `D1_WORKER_URL` from `.env.test` differs from `.env.local` (refuse if same — misconfiguration)
3. **Verify test DB marker** (`scripts/verify-test-db.ts`) — hard fail if marker missing (production safety)
4. **Clean `.next/dev/lock`** — Next.js prevents parallel dev server instances; stale lock from port 7046 blocks port 17046 startup (backy lesson)
5. Spawn `next dev --port 17046` directly (NOT `bun run dev` which hardcodes port 7046)
6. Wait for server ready (poll `http://localhost:17046/api/live`)
7. Run `bun test e2e/api/`
8. Kill server
9. Exit with test exit code

**`e2e/api/helpers.ts`** rewrite:
- Remove all `mock.module()`, `setD1Handler()`, `getD1Handler()` infrastructure
- Export `BASE = "http://localhost:17046"`
- Export helper functions for real HTTP: `get()`, `post()`, `put()`, `del()`
- Export `setupTestProject()` — creates a test project via API, returns token
- Export `cleanupTestData()` — deletes test data created during test run

**Test files rewrite pattern**:
```typescript
// BEFORE
mock.module("@/lib/db/d1-client", () => ({ ... }));
const { GET } = await import("@/app/api/projects/route");
const response = await GET();

// AFTER
const response = await fetch(`${BASE}/api/projects`);
```

**Verification**:
- `bun run test:e2e:api` starts server, runs tests, stops server
- All 7 test files pass against real HTTP + real D1 (test instance)
- No mock.module in any e2e test

**Commits** (atomic):
1. `feat(L2): add .env.test and E2E server lifecycle in run-e2e.ts`
2. `refactor(L2): rewrite e2e/api/helpers.ts for real HTTP`
3. `refactor(L2): rewrite e2e/api health + db-init tests for real HTTP`
4. `refactor(L2): rewrite e2e/api projects + recipients tests for real HTTP`
5. `refactor(L2): rewrite e2e/api templates + logs-stats tests for real HTTP`
6. `refactor(L2): rewrite e2e/api webhook test for real HTTP`

---

### Step 5: Implement L3 — Playwright BDD E2E ✅

**Files**:
- `playwright.config.ts` (NEW) — Playwright configuration
- `e2e/bdd/*.spec.ts` (NEW) — Core user flow specs

**Auth strategy — Bypassed app-flow coverage**:

`src/proxy.ts` already implements `E2E_SKIP_AUTH` (hardened in Step 2 with `NODE_ENV !== 'production'` guard). When enabled in non-production, all auth checks are skipped and every route is accessible without a session. **No new auth bypass code is needed.** This means:

- ✅ We test: navigation, page rendering, CRUD flows, data display, skeleton/loading states
- ❌ We do NOT test: Google OAuth login flow (not a stable CI target — requires real Google credentials)
- The `/login` page can be tested as a static render (verify it loads, shows Google button), but the actual OAuth redirect cannot be followed

**Core flows to test** (all with auth bypassed):
1. **Dashboard**: Visit `/` → verify stats cards render, chart loads, skeleton appears first
2. **Project CRUD**: Navigate to `/projects` → create project → verify listed → view detail → delete
3. **Template CRUD**: Navigate to `/templates` → create template → verify listed → edit → preview
4. **Send logs**: Navigate to `/send-logs` → verify table renders → filter by project
5. **Webhook logs**: Navigate to `/webhook-logs` → verify table renders → expand row
6. **Login page** (static): Visit `/login` → verify page loads, Google sign-in button visible

**`playwright.config.ts`**:
```typescript
export default defineConfig({
  testDir: './e2e/bdd',
  baseURL: 'http://localhost:27046',
  use: { headless: true },
  retries: process.env.CI ? 2 : 0,
  webServer: {
    // Playwright webServer is a separate shell process — process.env from
    // globalSetup does NOT propagate. Must inject via command env prefix.
    // ${VAR:?msg} is bash fail-closed: shell aborts if var is unset.
    command: [
      'D1_WORKER_URL=${D1_WORKER_URL_TEST:?not set}',
      'D1_WORKER_API_KEY=${D1_WORKER_API_KEY_TEST:?not set}',
      'E2E_SKIP_AUTH=true',
      'next dev --port 27046',
    ].join(' '),
    port: 27046,
    reuseExistingServer: !process.env.CI,
  },
});
```

> **Port note**: The `dev` script in `package.json` hardcodes `--port 7046`. Playwright's `webServer.command` must call `next dev --port 27046` directly to control the port.
>
> **Env injection note**: L3 Playwright needs the test Worker URL injected into the webServer shell. We use `D1_WORKER_URL_TEST` / `D1_WORKER_API_KEY_TEST` env vars (set in CI or local shell profile) and remap them to `D1_WORKER_URL` / `D1_WORKER_API_KEY` in the command prefix. The `${VAR:?}` syntax ensures a hard failure if credentials are missing — L3 is a hard gate, not soft.

**Commits** (atomic):
1. `feat(L3): add Playwright config`
2. `feat(L3): add dashboard and navigation BDD specs`
3. `feat(L3): add project CRUD BDD spec`
4. `feat(L3): add template CRUD BDD spec`
5. `feat(L3): add logs viewer BDD specs`

---

### Step 6: Wire L3 into CI / on-demand script ✅

**Files**:
- `package.json` — Change `test:e2e:bdd` script from `bun run e2e/bdd/runner.ts` (nonexistent) to `npx playwright test`

**Script change**:
```diff
- "test:e2e:bdd": "bun run e2e/bdd/runner.ts",
+ "test:e2e:bdd": "npx playwright test",
```

**No hook change**: L3 is manual/CI only per the quality system spec. `.husky/pre-push` is not modified.

**Verification**: Run `bun run test:e2e:bdd` — Playwright reads `playwright.config.ts`, starts webServer on 27046, runs all specs.

**Commit**: `chore: wire test:e2e:bdd to Playwright CLI`

---

## Verification Checklist

After all steps complete, verify the full matrix:

| Check | Command | Expected |
|-------|---------|----------|
| L1 | `bun run test:coverage` | 123+ tests, ≥90% coverage |
| G1 | `bun run typecheck && bun run lint` | 0 errors, 0 warnings |
| L2 | `bun run test:e2e:api` | Server starts on 17046, all tests pass via real HTTP against dove-db-test |
| G2 | `bun run gate:security` | osv-scanner + gitleaks both run and pass (hard fail if missing) |
| L3 | `bun run test:e2e:bdd` | Playwright runs core flows on 27046 |
| D1 | Verified by L2 | `_test_marker` check passes before tests, all queries hit dove-db-test |
| pre-commit | `git commit` | G1 + L1 sequential (<30s) |
| pre-push | `git push` | L2 ‖ G2 parallel (<3min) |

---

## Commit Sequence Summary

| # | Commit | Dimension |
|---|--------|-----------|
| 1 | `fix(G2): fail hard when security tools are not installed` | G2 |
| 2 | `fix: guard E2E auth bypass with NODE_ENV !== production` | Security |
| 3 | `feat(D1): deploy test Worker and add _test_marker verification` | D1 |
| 4 | `feat(L2): add .env.test and E2E server lifecycle in run-e2e.ts` | L2 |
| 5 | `refactor(L2): rewrite e2e/api/helpers.ts for real HTTP` | L2 |
| 6 | `refactor(L2): rewrite e2e/api health + db-init tests` | L2 |
| 7 | `refactor(L2): rewrite e2e/api projects + recipients tests` | L2 |
| 8 | `refactor(L2): rewrite e2e/api templates + logs-stats tests` | L2 |
| 9 | `refactor(L2): rewrite e2e/api webhook test` | L2 |
| 10 | `feat(L3): add Playwright config` | L3 |
| 11 | `feat(L3): add dashboard and navigation BDD specs` | L3 |
| 12 | `feat(L3): add project CRUD BDD spec` | L3 |
| 13 | `feat(L3): add template CRUD BDD spec` | L3 |
| 14 | `feat(L3): add logs viewer BDD specs` | L3 |
| 15 | `chore: wire test:e2e:bdd to Playwright CLI` | L3 |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Test Worker deployment fails | L2 blocks | Run `scripts/deploy-test-worker.sh` locally first; verify via `verify-test-db.ts` |
| Test Worker API key mismatch | L2 breaks | Separate `wrangler secret put API_KEY --env test`; `.env.test` uses matching key |
| `E2E_SKIP_AUTH` leaking to production | Security | **Step 2 adds `NODE_ENV !== 'production'` guard** in `src/proxy.ts`; even if env var is set, bypass is dead in production |
| Playwright flaky on CI | L3 unreliable | Use `retries: 2` in playwright.config, keep tests deterministic |
| E2E test data polluting test DB | D1 | Add cleanup in test afterAll hooks; `_test_marker` guarantees we're on test DB |
| Port conflict (7046 vs 17046/27046) | E2E breaks | Scripts use `next dev --port N` directly, never `bun run dev` |
| `.next/dev/lock` stale lock | E2E server won't start | `run-e2e.ts` cleans `.next/dev/lock` before spawn (backy lesson) |

### Gate Level Policy

Both L2 and L3 are **hard gates** when test infrastructure is missing:

| Gate | Missing test credentials | Missing `_test_marker` |
|------|--------------------------|------------------------|
| **L2** (pre-push, `run-e2e.ts`) | **Hard fail**: exit 1 (test Worker must be deployed) | **Hard fail**: refuse to run (production safety) |
| **L3** (on-demand, Playwright) | **Hard fail**: `${VAR:?}` aborts shell | **Hard fail**: refuse to run |

Rationale: Tier S requires all 6 dimensions green. Allowing L2 to silently skip would reintroduce the same class of loophole being removed from G2 in Step 1. If test infrastructure is not deployed, `git push` should fail — this ensures the team deploys the test Worker before claiming L2 compliance.

---

## Architecture Decision Record: D1 Test Isolation

### Context

The Cloudflare Worker (`worker/src/index.ts`) is a thin SQL proxy — it receives `{ sql, params }` and executes against its `env.DB` D1 binding. The client (`src/lib/db/d1-client.ts`) reads `D1_WORKER_URL` + `D1_WORKER_API_KEY` from process.env. There is no request-level env switch today, and adding one would introduce production risk.

The Worker's `wrangler.toml` already has `[env.test]` with a separate `dove-db-test` D1 binding.

### Decision: **Separate test Worker deployment (Option A — mandatory)**

Deploy via `wrangler deploy --env test`. This produces a distinct Worker at `dove-test.worker.hexly.ai` with its own `env.DB` → `dove-db-test`. The E2E `.env.test` points `D1_WORKER_URL` at this test Worker URL.

### Rejected: Request-level env routing (Option B)

Adding an `X-D1-Env` header to the production Worker would mean a single misrouted request could hit the wrong database. The Worker code would need conditional DB selection logic, increasing complexity and audit surface. Not worth the trade-off for a test-only use case.

### Consequences

- One extra Worker deployment to maintain (`--env test`)
- Separate API_KEY secret for test env
- Zero production risk — test and prod Workers are completely separate processes with separate D1 bindings
