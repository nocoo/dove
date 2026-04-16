/**
 * E2E: GET /api/live — Surety-standard health check endpoint.
 *
 * Real HTTP against running dev server on port 17032.
 */
import { describe, expect, test } from "bun:test";
import { get, parseJson } from "./helpers";

interface LiveResponse {
  status: string;
  version: string;
  component: string;
  timestamp: string;
  uptime: number;
  database: { connected: boolean; error?: string };
}

describe("GET /api/live", () => {
  test("returns surety-standard response when D1 is healthy", async () => {
    const response = await get("/api/live");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await parseJson<LiveResponse>(response);
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.component).toBe("dove");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
    expect(body.database.connected).toBe(true);
  });
});
