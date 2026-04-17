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
  test("creates all 6 tables", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { initializeSchema } = await import("@/lib/db/schema");
    await initializeSchema();

    const allSql = capturedBodies.map((b) => (JSON.parse(b) as { sql: string }).sql).join("\n");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS projects");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS recipients");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS templates");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS send_logs");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS webhook_logs");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS email_providers");
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
    expect(allSql).toContain("idx_email_providers_type");
  });

  test("includes new provider columns in fresh-install CREATE TABLE", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { SCHEMA_SQL } = await import("@/lib/db/schema");
    expect(SCHEMA_SQL).toContain("provider_id TEXT REFERENCES email_providers(id)");
    expect(SCHEMA_SQL).toContain("provider_type TEXT");
    expect(SCHEMA_SQL).toContain("provider_message_id TEXT");
  });

  test("runs backfill UPDATE statements", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { initializeSchema } = await import("@/lib/db/schema");
    await initializeSchema();

    const allSql = capturedBodies.map((b) => (JSON.parse(b) as { sql: string }).sql).join("\n");
    expect(allSql).toContain("UPDATE send_logs SET provider_type = 'legacy'");
    // Must backfill ALL NULLs (including historical failed rows), not
    // just those with a resend_id — otherwise old failed legacy sends
    // lose provider provenance.
    expect(allSql).toContain(
      "UPDATE send_logs SET provider_type = 'legacy' WHERE provider_type IS NULL",
    );
    expect(allSql).not.toContain(
      "provider_type = 'legacy' WHERE provider_type IS NULL AND resend_id IS NOT NULL",
    );
    expect(allSql).toContain("UPDATE send_logs SET provider_message_id = resend_id");
  });
});

describe("ensureColumn", () => {
  test("no-ops when column already exists", async () => {
    let altered = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { sql: string };
      if (body.sql.startsWith("PRAGMA")) {
        return d1Success([{ name: "provider_id" }]);
      }
      if (body.sql.startsWith("ALTER")) {
        altered = true;
      }
      return d1Success([]);
    });

    const { ensureColumn } = await import("@/lib/db/schema");
    await ensureColumn("projects", "provider_id", "TEXT");
    expect(altered).toBe(false);
  });

  test("issues ALTER TABLE when column missing", async () => {
    let altered = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { sql: string };
      if (body.sql.startsWith("PRAGMA")) {
        return d1Success([{ name: "other_column" }]);
      }
      if (body.sql.startsWith("ALTER")) {
        altered = true;
        expect(body.sql).toContain("ALTER TABLE projects ADD COLUMN provider_id TEXT");
      }
      return d1Success([]);
    });

    const { ensureColumn } = await import("@/lib/db/schema");
    await ensureColumn("projects", "provider_id", "TEXT");
    expect(altered).toBe(true);
  });
});
