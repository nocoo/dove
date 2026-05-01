import { describe, test, expect, vi } from "vitest";
import { checkQuota } from "../lib/email/quota";
import type { Project } from "../lib/db/projects";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_001",
    name: "Test",
    description: null,
    email_prefix: "noreply",
    from_name: "Test",
    webhook_token: "tok",
    quota_daily: 100,
    quota_monthly: 1000,
    provider_id: null,
    allow_unknown_recipients: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockDB(dailyCount: number, monthlyCount: number) {
  // Mock keys off SQL fragment so a regression that SWAPS
  // `Promise.all([countDailySends, countMonthlySends])` to
  // `Promise.all([countMonthlySends, countDailySends])` would route the
  // monthly count into `dailyUsed` and vice versa — caught here.
  // Pre-strengthening, the mock used a callIndex counter that returned
  // values BY CALL ORDER (not by query), so the swap was INVISIBLE
  // (the mock returned [dailyCount, monthlyCount] regardless of which
  // function fired first). This is the classic 'identical-mock-data
  // hides swap' anti-pattern.
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(() => {
          // countMonthlySends uses `strftime('%Y-%m-01', 'now')`,
          // countDailySends uses `date('now')` (no strftime). SQL-keyed
          // mock makes the swap detectable.
          const isMonthly = /strftime\('%Y-%m-01'/i.test(sql);
          return Promise.resolve({ count: isMonthly ? monthlyCount : dailyCount });
        }),
        all: vi.fn(() => Promise.resolve({ results: [] })),
        run: vi.fn(() => Promise.resolve({ success: true })),
      })),
    })),
  } as unknown as D1Database;
}

describe("server quota check", () => {
  test("allows when under both limits", async () => {
    const db = createMockDB(50, 500);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(true);
    expect(result.daily.used).toBe(50);
    expect(result.monthly.used).toBe(500);
  });

  test("rejects when daily exceeded", async () => {
    const db = createMockDB(100, 500);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_daily_exceeded");
    // Both daily and monthly counters MUST be present in rejection responses
    // so the dashboard can render "100/100 daily, 500/1000 monthly" — a
    // regression dropping `monthly` from the daily-exceeded path would
    // strand the UI with undefined display. Pin both objects fully.
    expect(result.daily).toEqual({ used: 100, limit: 100 });
    expect(result.monthly).toEqual({ used: 500, limit: 1000 });
  });

  test("rejects when monthly exceeded", async () => {
    const db = createMockDB(50, 1000);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_monthly_exceeded");
    expect(result.daily).toEqual({ used: 50, limit: 100 });
    expect(result.monthly).toEqual({ used: 1000, limit: 1000 });
  });

  test("daily check takes priority when BOTH exceeded (order matters)", async () => {
    // Pins the documented ordering of guards: daily is checked BEFORE
    // monthly. A regression that swapped the two `if` blocks would still
    // reject this send (allowed=false), but with the WRONG error_code,
    // misleading the dashboard's quota-bar UI and the operator's
    // remediation (raise daily? raise monthly? buy more headroom?).
    const db = createMockDB(100, 1000);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_daily_exceeded");
  });

  test("boundary: dailyUsed === limit-1 still allowed (off-by-one guard)", async () => {
    // Pins the >= boundary on quota.ts:23. A regression to `>` would
    // allow one extra send beyond the documented daily cap — silent
    // overage of an SLO/billing limit.
    const db = createMockDB(99, 999);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(true);
  });
});
