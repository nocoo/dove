import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success } from "./helpers";

let originalFetch: typeof globalThis.fetch;
let capturedBodies: string[] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  capturedBodies = [];
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("initializeSchema", () => {
  test("creates all 5 tables", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { initializeSchema } = await import("@/lib/db/schema");
    await initializeSchema();

    // Should have at least 5 CREATE TABLE statements (one per table)
    const allSql = capturedBodies.map((b) => (JSON.parse(b) as { sql: string }).sql).join("\n");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS projects");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS recipients");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS templates");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS send_logs");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS webhook_logs");
  });

  test("creates indexes", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { initializeSchema } = await import("@/lib/db/schema");
    await initializeSchema();

    const allSql = capturedBodies.map((b) => (JSON.parse(b) as { sql: string }).sql).join("\n");
    expect(allSql).toContain("CREATE INDEX");
  });
});
