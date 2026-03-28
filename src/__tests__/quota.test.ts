import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, makeProject } from "./helpers";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("checkQuota", () => {
  test("allows when both quotas have room", async () => {
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount++;
      return d1Success([{ count: callCount === 1 ? 10 : 100 }]);
    });

    const { checkQuota } = await import("@/lib/email/quota");
    const project = makeProject({ quota_daily: 100, quota_monthly: 1000 });
    const result = await checkQuota(project);

    expect(result.allowed).toBe(true);
    expect(result.daily.used).toBe(10);
    expect(result.monthly.used).toBe(100);
  });

  test("rejects when daily quota exceeded", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([{ count: 100 }]));

    const { checkQuota } = await import("@/lib/email/quota");
    const project = makeProject({ quota_daily: 100, quota_monthly: 1000 });
    const result = await checkQuota(project);

    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_daily_exceeded");
  });

  test("rejects when monthly quota exceeded", async () => {
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount++;
      // Daily: 10 (under), Monthly: 1000 (at limit)
      return d1Success([{ count: callCount === 1 ? 10 : 1000 }]);
    });

    const { checkQuota } = await import("@/lib/email/quota");
    const project = makeProject({ quota_daily: 100, quota_monthly: 1000 });
    const result = await checkQuota(project);

    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("quota_monthly_exceeded");
  });

  test("checks daily first (short-circuits)", async () => {
    // Both daily and monthly exceeded — should report daily
    globalThis.fetch = mockFetch(async () => d1Success([{ count: 9999 }]));

    const { checkQuota } = await import("@/lib/email/quota");
    const project = makeProject({ quota_daily: 100, quota_monthly: 1000 });
    const result = await checkQuota(project);

    expect(result.error_code).toBe("quota_daily_exceeded");
  });
});
