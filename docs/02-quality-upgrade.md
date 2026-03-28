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
| **L2** | ✅ True HTTP | Real HTTP calls to running dev server on port 17046, connecting to `dove-db-test` via Worker test env |
| **G2** | ✅ Hard fail | Remove soft-skip: fail if osv-scanner or gitleaks not installed |
| **L3** | ✅ Playwright | Core user flow: login → dashboard → create project → create template → verify send log |
| **D1** | ✅ Full isolation | `_test_marker` table, Worker test env binding, E2E connect to `dove-db-test` |

**Target Tier: S** (6/6 green)

---

## Implementation Steps

### Step 1: Harden G2 — Remove soft-skip loophole

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

### Step 2: D1 Test Isolation — Add `_test_marker` table + verification

**Files**:
- `worker/src/index.ts` — Add `_test_marker` table creation to test env schema init
- `src/lib/db/schema.ts` — Add `_test_marker` CREATE TABLE
- `scripts/verify-test-db.ts` (NEW) — Script to verify connected DB is the test instance
- `scripts/run-e2e.ts` — Call verify-test-db before running tests

**Design**:

The `_test_marker` table contains a single row `(key='env', value='test')`. Before any E2E test run, the runner verifies this marker exists. If it doesn't, the test suite refuses to run — protecting production data.

```sql
CREATE TABLE IF NOT EXISTS _test_marker (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO _test_marker (key, value) VALUES ('env', 'test');
```

**`scripts/verify-test-db.ts`**:
```typescript
// Connects to the D1 worker test env and verifies _test_marker exists
// Uses D1_WORKER_URL_TEST + D1_WORKER_API_KEY_TEST env vars
// Exits non-zero if marker is missing
```

**Commit**: `feat(D1): add _test_marker table and verification script`

---

### Step 3: Rewrite L2 — True HTTP E2E against running server

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
# D1 Worker proxy pointing to test instance
D1_WORKER_URL=https://dove.worker.hexly.ai  # same worker
D1_WORKER_API_KEY=<test-env-key>
D1_WORKER_ENV=test                           # tells worker to use [env.test] bindings

# Skip auth for E2E
E2E_SKIP_AUTH=1

# Port
PORT=17046
```

**`scripts/run-e2e.ts`** rewrite:
1. Verify test DB marker (`scripts/verify-test-db.ts`)
2. Spawn `next dev --port 17046` with `.env.test`
3. Wait for server ready (poll `http://localhost:17046/api/live`)
4. Run `bun test e2e/api/`
5. Kill server
6. Exit with test exit code

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

### Step 4: Implement L3 — Playwright BDD E2E

**Files**:
- `playwright.config.ts` (NEW) — Playwright configuration
- `e2e/bdd/runner.ts` (NEW) — BDD test runner (server lifecycle for port 27046)
- `e2e/bdd/*.spec.ts` (NEW) — Core user flow specs

**Core flows to test**:
1. **Auth flow**: Visit `/` → redirected to `/login` → Google OAuth → dashboard
2. **Dashboard**: Verify stats cards render, chart loads
3. **Project CRUD**: Create project → verify listed → view detail → delete
4. **Template CRUD**: Create template → verify listed → edit → preview
5. **Send logs**: Navigate → verify table renders → filter by project
6. **Webhook logs**: Navigate → verify table renders → expand row

**`playwright.config.ts`**:
```typescript
export default defineConfig({
  testDir: './e2e/bdd',
  baseURL: 'http://localhost:27046',
  use: { headless: true },
  webServer: {
    command: 'E2E_SKIP_AUTH=1 bun run dev -- --port 27046',
    port: 27046,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Auth bypass**: Use `E2E_SKIP_AUTH=1` env var. The auth middleware must respect this flag in non-production mode to skip NextAuth session checks.

**Commits** (atomic):
1. `feat(L3): add Playwright config and BDD runner`
2. `feat(L3): add auth bypass middleware for E2E`
3. `feat(L3): add dashboard and navigation BDD specs`
4. `feat(L3): add project CRUD BDD spec`
5. `feat(L3): add template CRUD BDD spec`
6. `feat(L3): add logs viewer BDD specs`

---

### Step 5: Wire L3 into CI / on-demand script

**Files**:
- `package.json` — Verify `test:e2e:bdd` script works
- `.husky/pre-push` — L3 remains on-demand (not in pre-push per spec)

**No hook change**: L3 is manual/CI only per the quality system spec.

**Commit**: `chore: verify L3 Playwright E2E on-demand wiring`

---

### Step 6: Add E2E auth bypass to middleware

**Files**:
- `src/auth.ts` or `src/middleware.ts` — Check `E2E_SKIP_AUTH` env var
- Guard: Only effective when `NODE_ENV !== 'production'`

**Design**:
```typescript
if (process.env.E2E_SKIP_AUTH === '1' && process.env.NODE_ENV !== 'production') {
  // Bypass auth — return mock session
}
```

**Commit**: `feat: add E2E auth bypass (non-production only)`

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
| 2 | `feat(D1): add _test_marker table and verification script` | D1 |
| 3 | `feat(L2): add .env.test and E2E server lifecycle in run-e2e.ts` | L2 |
| 4 | `refactor(L2): rewrite e2e/api/helpers.ts for real HTTP` | L2 |
| 5 | `refactor(L2): rewrite e2e/api health + db-init tests` | L2 |
| 6 | `refactor(L2): rewrite e2e/api projects + recipients tests` | L2 |
| 7 | `refactor(L2): rewrite e2e/api templates + logs-stats tests` | L2 |
| 8 | `refactor(L2): rewrite e2e/api webhook test` | L2 |
| 9 | `feat: add E2E auth bypass (non-production only)` | L3 prereq |
| 10 | `feat(L3): add Playwright config and BDD runner` | L3 |
| 11 | `feat(L3): add dashboard and navigation BDD specs` | L3 |
| 12 | `feat(L3): add project CRUD BDD spec` | L3 |
| 13 | `feat(L3): add template CRUD BDD spec` | L3 |
| 14 | `feat(L3): add logs viewer BDD specs` | L3 |
| 15 | `chore: verify L3 Playwright E2E on-demand wiring` | L3 |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Worker test env not deploying correctly | L2 breaks | Test `wrangler dev --env test` locally first |
| D1 Worker proxy API key differs for test | L2 breaks | Use same API key, env routing in Worker handles DB selection |
| Auth bypass leaking to production | Security | Guard with `NODE_ENV !== 'production'` check |
| Playwright flaky on CI | L3 unreliable | Use `retries: 2` in playwright.config, keep tests deterministic |
| E2E test data polluting test DB | D1 | Add cleanup in test afterAll hooks |

---

## Architecture Decision: Worker Env Routing for D1 Test

The Cloudflare Worker already has `[env.test]` in `wrangler.toml`. To route L2 E2E to the test D1:

**Option A**: Deploy a separate test Worker instance (`wrangler deploy --env test`)
- Pros: Complete isolation at Worker level
- Cons: Extra deployment, separate URL

**Option B**: Add request-level env routing in the existing Worker
- Pros: Single Worker, route via header (e.g., `X-D1-Env: test`)
- Cons: Slight prod risk if header leaks

**Recommendation**: **Option A** — deploy `dove-test` Worker separately. The E2E `.env.test` points to `dove-test.worker.hexly.ai`. Zero risk to production.
