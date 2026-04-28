/**
 * E2E: POST /api/db/init — Schema initialization endpoint.
 *
 * Real HTTP against running dev server on port 17034.
 * Server runs in development mode, so this endpoint is allowed.
 * Schema uses IF NOT EXISTS, so it's idempotent.
 */
import { describe, expect, test } from "vitest";
import { get, post, parseJson } from "./helpers";

describe("POST /api/db/init", () => {
  test("initializes schema in non-production (idempotent)", async () => {
    const response = await post("/api/db/init");

    expect(response.status).toBe(200);
    const body = await parseJson<{ ok: boolean; statements: number }>(response);
    expect(body.ok).toBe(true);
    expect(body.statements).toBeGreaterThan(0);
  }, 30_000); // Schema init touches D1 with 17+ statements — allow extra time
});

describe("GET /api/db/init/marker", () => {
  test("returns the test-db marker after schema init", async () => {
    const response = await get("/api/db/init/marker");
    expect(response.status).toBe(200);
    const body = await parseJson<{ marker: string | null }>(response);
    expect(body.marker).toBe("e2e-test-db");
  });
});

