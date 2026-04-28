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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockDB(dailyCount: number, monthlyCount: number) {
  let callIndex = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(() => {
          callIndex++;
          return Promise.resolve({ count: callIndex === 1 ? dailyCount : monthlyCount });
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
  });

  test("rejects when monthly exceeded", async () => {
    const db = createMockDB(50, 1000);
    const result = await checkQuota(db, makeProject());
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_monthly_exceeded");
  });
});
