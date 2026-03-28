import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, makeWebhookLog } from "./helpers";

let originalFetch: typeof globalThis.fetch;
let capturedBody = "";

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listWebhookLogs", () => {
  test("queries by project_id with pagination", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([makeWebhookLog()]);
    });

    const { listWebhookLogs } = await import("@/lib/db/webhook-logs");
    const result = await listWebhookLogs("proj_123", { limit: 10, offset: 5 });

    expect(result).toHaveLength(1);
    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("WHERE project_id = ?");
    expect(body.sql).toContain("LIMIT ? OFFSET ?");
    expect(body.params).toContain(10);
    expect(body.params).toContain(5);
  });
});

describe("listAllWebhookLogs", () => {
  test("queries without project filter", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { listAllWebhookLogs } = await import("@/lib/db/webhook-logs");
    await listAllWebhookLogs();

    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).not.toContain("WHERE project_id");
    expect(body.sql).toContain("ORDER BY created_at DESC");
  });
});

describe("createWebhookLog", () => {
  test("inserts log with all fields", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createWebhookLog } = await import("@/lib/db/webhook-logs");
    await createWebhookLog({
      project_id: "proj_123",
      method: "POST",
      path: "/api/webhook/proj_123/send",
      status_code: 200,
      error_code: "auth_invalid",
      error_message: "Bad token",
      duration_ms: 150,
      ip: "1.2.3.4",
      user_agent: "test-agent",
    });

    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("INSERT INTO webhook_logs");
    expect(body.params).toContain("POST");
    expect(body.params).toContain(200);
    expect(body.params).toContain("auth_invalid");
  });

  test("handles optional fields as null", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createWebhookLog } = await import("@/lib/db/webhook-logs");
    await createWebhookLog({
      project_id: "proj_123",
      method: "HEAD",
      path: "/api/webhook/proj_123",
      status_code: 200,
    });

    const body = JSON.parse(capturedBody) as { params: unknown[] };
    // error_code, error_message, duration_ms, ip, user_agent should be null
    expect(body.params.filter((p) => p === null)).toHaveLength(5);
  });
});
