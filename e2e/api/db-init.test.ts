/**
 * E2E: POST /api/db/init — Schema initialization endpoint.
 *
 * Mocks only D1 client.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import { parseJson, getD1Handler, setD1Handler, resetD1Handler } from "./helpers";

// Mock D1 at the boundary
let d1ShouldFail = false;

mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => {
    if (d1ShouldFail) throw new Error("D1 unavailable");
    return getD1Handler()(sql, params);
  },
}));

beforeEach(() => {
  resetD1Handler();
  d1ShouldFail = false;
  spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/db/init", () => {
  test("initializes schema in non-production", async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/db/init/route");
    const response = await POST();

    expect(response.status).toBe(200);
    const body = await parseJson<{ success: boolean }>(response);
    expect(body.success).toBe(true);

    process.env.NODE_ENV = oldEnv;
  });

  test("rejects in production", async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const { POST } = await import("@/app/api/db/init/route");
    const response = await POST();

    expect(response.status).toBe(403);

    process.env.NODE_ENV = oldEnv;
  });

  test("returns 500 on D1 failure", async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    d1ShouldFail = true;

    const { POST } = await import("@/app/api/db/init/route");
    const response = await POST();

    expect(response.status).toBe(500);

    process.env.NODE_ENV = oldEnv;
  });
});
