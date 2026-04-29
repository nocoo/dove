import { describe, test, expect, vi } from "vitest";
import app from "../index";
import type { Env } from "../env";

// /api/live is the unauthenticated liveness probe used by Cloudflare's
// health checker, our deploy gate, and the dashboard's connectivity badge.
// Before this file, NO test exercised it — a regression dropping the DB
// ping, swapping the status-code semantics, or omitting the version field
// would silently flip a healthy worker into a "200 ok" lie or a 503
// outage. These tests pin the documented contract.

function createMockDB(opts: { firstResult?: unknown; throws?: unknown } = {}) {
  const { firstResult = { ping: 1 }, throws } = opts;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(() => {
          if (throws !== undefined) return Promise.reject(throws);
          return Promise.resolve(firstResult);
        }),
      })),
      first: vi.fn(() => {
        if (throws !== undefined) return Promise.reject(throws);
        return Promise.resolve(firstResult);
      }),
    })),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database): Env {
  return { DB: db } as unknown as Env;
}

describe("GET /api/live", () => {
  test("returns 200 + status=ok when DB ping succeeds", async () => {
    const env = makeEnv(createMockDB({ firstResult: { ping: 1 } }));
    const res = await app.request("/api/live", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      version: string;
      component: string;
      timestamp: string;
      uptime: number;
      database: { connected: boolean; error?: string };
    };
    expect(body.status).toBe("ok");
    expect(body.component).toBe("dove");
    // Version MUST be a semver-shaped string, not an empty/undefined leak
    // that would render as "Dove undefined" in dashboards.
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    // Timestamp must be ISO-8601 (downstream log aggregators parse it).
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Uptime is a non-negative number; precision doesn't matter.
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.database.connected).toBe(true);
    expect(body.database.error).toBeUndefined();
  });

  test("returns 503 + status=error when DB ping returns null (no rows)", async () => {
    // Pins the `dbConnected = result !== null` contract. A regression that
    // truthy-checked instead would still report 'ok' for a working
    // SELECT-that-returned-no-rows situation, but null is the actual
    // signal D1 uses when the worker can't reach the binding.
    const env = makeEnv(createMockDB({ firstResult: null }));
    const res = await app.request("/api/live", { method: "GET" }, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; database: { connected: boolean } };
    expect(body.status).toBe("error");
    expect(body.database.connected).toBe(false);
  });

  test("returns 503 + surfaces error message when DB throws", async () => {
    // The handler MUST surface the underlying error message so an
    // operator looking at curl output can diagnose without needing
    // worker logs (which can lag minutes on Cloudflare).
    const env = makeEnv(createMockDB({ throws: new Error("D1_ERROR: binding unavailable") }));
    const res = await app.request("/api/live", { method: "GET" }, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      database: { connected: boolean; error: string };
    };
    expect(body.status).toBe("error");
    expect(body.database.connected).toBe(false);
    expect(body.database.error).toBe("D1_ERROR: binding unavailable");
  });

  test("coerces non-Error throws to 'Unknown error' (defensive default)", async () => {
    // If the binding rejects with a non-Error (e.g. plain string from a
    // weird runtime path), the handler MUST still respond — never throw
    // 500 with no body. Pins the `err instanceof Error ? msg : 'Unknown error'`
    // fallback.
    const env = makeEnv(createMockDB({ throws: "raw string failure" }));
    const res = await app.request("/api/live", { method: "GET" }, env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { database: { error: string } };
    expect(body.database.error).toBe("Unknown error");
  });

  test("sets cache-control: no-store to prevent CDN/HTTP caching of liveness", async () => {
    // CRITICAL: liveness probes that get cached are useless — a stale
    // 'ok' from 5 minutes ago can mask a current outage. Pin the header.
    const env = makeEnv(createMockDB({ firstResult: { ping: 1 } }));
    const res = await app.request("/api/live", { method: "GET" }, env);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
