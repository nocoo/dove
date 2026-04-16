/**
 * Unit: GET /api/live — Health check endpoint.
 *
 * Mocks next/server and D1 client to test the route handler in isolation.
 */
import { describe, expect, test, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { mockFetch, d1Success } from "./helpers";

// Mock next/server before importing the route
mock.module("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));

let originalFetch: typeof globalThis.fetch;
let originalUrl: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalUrl = process.env.D1_WORKER_URL;
  originalKey = process.env.D1_WORKER_API_KEY;
  process.env.D1_WORKER_URL = "https://test-worker.example.com";
  process.env.D1_WORKER_API_KEY = "test-api-key";
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

describe("GET /api/live", () => {
  test("returns 200 with status ok, version, and component when D1 is healthy", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([{ "1": 1 }]));

    const { GET } = await import("@/app/api/live/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.component).toBe("dove");
    expect(body.d1).toBe(true);
  });

  test("returns 503 degraded when D1 ping fails", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("connection refused");
    });

    const { GET } = await import("@/app/api/live/route");
    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(typeof body.version).toBe("string");
    expect(body.component).toBe("dove");
    expect(body.d1).toBe(false);
  });
});
