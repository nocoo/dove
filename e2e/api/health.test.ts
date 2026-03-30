/**
 * E2E: GET /api/live — Health check endpoint.
 *
 * Real HTTP against running dev server on port 17032.
 */
import { describe, expect, test } from "bun:test";
import { get, parseJson } from "./helpers";

describe("GET /api/live", () => {
  test("returns ok when D1 is healthy", async () => {
    const response = await get("/api/live");

    expect(response.status).toBe(200);
    const body = await parseJson<{ status: string; version: string; d1: boolean }>(response);
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.d1).toBe(true);
  });
});
