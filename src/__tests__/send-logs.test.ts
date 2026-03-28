import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, makeSendLog } from "./helpers";

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

describe("listSendLogs", () => {
  test("queries with default limit and offset", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([makeSendLog()]);
    });

    const { listSendLogs } = await import("@/lib/db/send-logs");
    const result = await listSendLogs("proj_123");

    expect(result).toHaveLength(1);
    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("WHERE project_id = ?");
    expect(body.sql).toContain("LIMIT ?");
    expect(body.params).toContain(50); // default limit
  });

  test("applies status filter when provided", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { listSendLogs } = await import("@/lib/db/send-logs");
    await listSendLogs("proj_123", { status: "failed" });

    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("AND status = ?");
    expect(body.params).toContain("failed");
  });
});

describe("listAllSendLogs", () => {
  test("queries without project filter", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { listAllSendLogs } = await import("@/lib/db/send-logs");
    await listAllSendLogs();

    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).not.toContain("WHERE project_id");
    expect(body.sql).toContain("ORDER BY created_at DESC");
  });
});

describe("findByIdempotencyKey", () => {
  test("finds existing log by project and key", async () => {
    const log = makeSendLog({ idempotency_key: "test-key-123" });
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([log]);
    });

    const { findByIdempotencyKey } = await import("@/lib/db/send-logs");
    const result = await findByIdempotencyKey("proj_123", "test-key-123");

    expect(result?.idempotency_key).toBe("test-key-123");
    const body = JSON.parse(capturedBody) as { sql: string; params: string[] };
    expect(body.sql).toContain("idempotency_key = ?");
  });

  test("returns undefined when not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { findByIdempotencyKey } = await import("@/lib/db/send-logs");
    const result = await findByIdempotencyKey("proj_123", "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("createSendLog", () => {
  test("creates log with sending status", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createSendLog } = await import("@/lib/db/send-logs");
    const result = await createSendLog({
      project_id: "proj_123",
      template_id: "tmpl_123",
      recipient_id: "rcpt_123",
      to_email: "test@example.com",
      subject: "Test",
    });

    expect(result.id).toHaveLength(21);
    expect(result.status).toBe("sending");
    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).toContain("INSERT INTO send_logs");
    expect(body.sql).toContain("'sending'");
  });

  test("accepts optional idempotency_key and payload_hash", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createSendLog } = await import("@/lib/db/send-logs");
    const result = await createSendLog({
      project_id: "proj_123",
      idempotency_key: "idem-key-1",
      payload_hash: "abc123hash",
      template_id: "tmpl_123",
      recipient_id: "rcpt_123",
      to_email: "test@example.com",
      subject: "Test",
    });

    expect(result.idempotency_key).toBe("idem-key-1");
    expect(result.payload_hash).toBe("abc123hash");
  });
});

describe("markSendLogSent", () => {
  test("updates status and sets resend_id", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { markSendLogSent } = await import("@/lib/db/send-logs");
    await markSendLogSent("slog_123", "resend_xyz");

    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("UPDATE send_logs SET status = 'sent'");
    expect(body.params).toContain("resend_xyz");
  });
});

describe("markSendLogFailed", () => {
  test("updates status and sets error_message", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { markSendLogFailed } = await import("@/lib/db/send-logs");
    await markSendLogFailed("slog_123", "API error");

    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("UPDATE send_logs SET status = 'failed'");
    expect(body.params).toContain("API error");
  });
});

describe("countDailySends", () => {
  test("counts sends for today using UTC boundaries", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([{ count: 42 }]);
    });

    const { countDailySends } = await import("@/lib/db/send-logs");
    const count = await countDailySends("proj_123");

    expect(count).toBe(42);
    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).toContain("status = 'sent'");
    expect(body.sql).toContain("sent_at");
  });
});

describe("countMonthlySends", () => {
  test("counts sends for this month using UTC boundaries", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([{ count: 500 }]);
    });

    const { countMonthlySends } = await import("@/lib/db/send-logs");
    const count = await countMonthlySends("proj_123");

    expect(count).toBe(500);
    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).toContain("status = 'sent'");
  });
});

describe("resetSendLogForRetry", () => {
  test("resets failed log to sending status", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { resetSendLogForRetry } = await import("@/lib/db/send-logs");
    await resetSendLogForRetry("slog_123", {
      to_email: "new@example.com",
      subject: "New Subject",
    });

    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("UPDATE send_logs SET status = 'sending'");
    expect(body.params).toContain("new@example.com");
    expect(body.params).toContain("New Subject");
  });
});
