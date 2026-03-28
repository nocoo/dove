import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, d1Error } from "./helpers";

// Save and restore env + fetch
let originalFetch: typeof globalThis.fetch;
let originalUrl: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalUrl = process.env.D1_WORKER_URL;
  originalKey = process.env.D1_WORKER_API_KEY;
  process.env.D1_WORKER_URL = "https://test-worker.example.com";
  process.env.D1_WORKER_API_KEY = "test-api-key";
  // Suppress console.warn/error during tests
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) {
    delete process.env.D1_WORKER_URL;
  } else {
    process.env.D1_WORKER_URL = originalUrl;
  }
  if (originalKey === undefined) {
    delete process.env.D1_WORKER_API_KEY;
  } else {
    process.env.D1_WORKER_API_KEY = originalKey;
  }
});

// Must use dynamic import to get fresh module state after env changes
async function getModule() {
  // Cache busting not needed with bun:test, but using the stable import
  const mod = await import("@/lib/db/d1-client");
  return mod;
}

describe("executeD1Query", () => {
  test("sends SQL and params to the Worker proxy", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      capturedUrl = input as string;
      capturedBody = init?.body as string;
      return d1Success([{ id: "1" }]);
    });

    const { executeD1Query } = await getModule();
    const result = await executeD1Query<{ id: string }>("SELECT * FROM t WHERE id = ?", ["1"]);

    expect(capturedUrl).toBe("https://test-worker.example.com/query");
    const body = JSON.parse(capturedBody) as { sql: string; params: string[] };
    expect(body.sql).toBe("SELECT * FROM t WHERE id = ?");
    expect(body.params).toEqual(["1"]);
    expect(result).toEqual([{ id: "1" }]);
  });

  test("sends X-API-Key header", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mockFetch(async (_input, init) => {
      const h = init?.headers as Record<string, string>;
      capturedHeaders = h;
      return d1Success([]);
    });

    const { executeD1Query } = await getModule();
    await executeD1Query("SELECT 1");

    expect(capturedHeaders["X-API-Key"]).toBe("test-api-key");
  });

  test("throws when D1 credentials are not configured", async () => {
    delete process.env.D1_WORKER_URL;
    delete process.env.D1_WORKER_API_KEY;

    const { executeD1Query } = await getModule();
    await expect(executeD1Query("SELECT 1")).rejects.toThrow("D1 Worker credentials not configured");
  });

  test("returns empty array when no results", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { executeD1Query } = await getModule();
    const result = await executeD1Query("SELECT 1");
    expect(result).toEqual([]);
  });

  test("throws on UNIQUE constraint error", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(
        JSON.stringify({ success: false, error: "UNIQUE constraint failed: projects.name" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { executeD1Query } = await getModule();
    await expect(executeD1Query("INSERT INTO t VALUES (?)")).rejects.toThrow("UNIQUE constraint failed");
  });

  test("throws on non-transient 4xx error without retry", async () => {
    let fetchCount = 0;
    globalThis.fetch = mockFetch(async () => {
      fetchCount++;
      return d1Error("Bad request", 400);
    });

    const { executeD1Query } = await getModule();
    await expect(executeD1Query("BAD SQL")).rejects.toThrow("D1 query failed");
    expect(fetchCount).toBe(1); // No retries on 4xx
  });

  test("returns results when response has no results key", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { executeD1Query } = await getModule();
    const result = await executeD1Query("SELECT 1");
    expect(result).toEqual([]);
  });

  test("throws on D1 API error (non-transient)", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(
        JSON.stringify({ success: false, error: "syntax error" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { executeD1Query } = await getModule();
    await expect(executeD1Query("INVALID SQL")).rejects.toThrow("D1 query failed");
  });
});

describe("isD1Configured", () => {
  test("returns true when both env vars are set", async () => {
    const { isD1Configured } = await getModule();
    expect(isD1Configured()).toBe(true);
  });

  test("returns false when URL is missing", async () => {
    delete process.env.D1_WORKER_URL;
    const { isD1Configured } = await getModule();
    expect(isD1Configured()).toBe(false);
  });

  test("returns false when API key is missing", async () => {
    delete process.env.D1_WORKER_API_KEY;
    const { isD1Configured } = await getModule();
    expect(isD1Configured()).toBe(false);
  });
});
