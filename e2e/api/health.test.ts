/**
 * E2E: GET /api/live — Health check endpoint.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import { parseJson, getD1Handler, setD1Handler, resetD1Handler } from "./helpers";

// Mock D1 at the boundary
mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

// Mock version constant (module-level const, not dynamic env read)
mock.module("@/lib/version", () => ({
  APP_VERSION: "1.0.0-e2e",
}));

beforeEach(() => {
  resetD1Handler();
  spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/live", () => {
  test("returns ok when D1 is healthy", async () => {
    setD1Handler(() => [{ "1": 1 }]);
    const { GET } = await import("@/app/api/live/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await parseJson<{ status: string; version: string; d1: boolean }>(response);
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.0.0-e2e");
    expect(body.d1).toBe(true);
  });

  test("returns 503 when D1 ping fails", async () => {
    setD1Handler(() => { throw new Error("D1 down"); });
    const { GET } = await import("@/app/api/live/route");
    const response = await GET();

    expect(response.status).toBe(503);
    const body = await parseJson<{ status: string; d1: boolean }>(response);
    expect(body.status).toBe("degraded");
    expect(body.d1).toBe(false);
  });
});
