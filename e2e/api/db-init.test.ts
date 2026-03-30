/**
 * E2E: POST /api/db/init — Schema initialization endpoint.
 *
 * Real HTTP against running dev server on port 17032.
 * Server runs in development mode, so this endpoint is allowed.
 * Schema uses IF NOT EXISTS, so it's idempotent.
 */
import { describe, expect, test } from "bun:test";
import { post, parseJson } from "./helpers";

describe("POST /api/db/init", () => {
  test("initializes schema in non-production (idempotent)", async () => {
    const response = await post("/api/db/init");

    expect(response.status).toBe(200);
    const body = await parseJson<{ success: boolean }>(response);
    expect(body.success).toBe(true);
  }, 30_000); // Schema init touches D1 with 17+ statements — allow extra time
});
