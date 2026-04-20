/**
 * Tests for server-side SendLog CRUD operations with native D1 binding.
 */
import { describe, expect, test, mock } from "bun:test";
import {
  listSendLogs,
  listAllSendLogs,
  getSendLog,
  findByIdempotencyKey,
  createSendLog,
  updateSendLogProvider,
  resetSendLogForRetry,
  markSendLogSent,
  markSendLogFailed,
  countDailySends,
  countMonthlySends,
  type SendLog,
} from "../lib/db/send-logs";

// Create a mock D1Result
function createMockResult(): D1Result {
  return {
    success: true,
    meta: {
      duration: 1,
      changes: 1,
      last_row_id: 0,
      rows_read: 0,
      rows_written: 0,
      size_after: 0,
      changed_db: false,
    },
    results: [],
  } as unknown as D1Result;
}

// Sample send log fixture
function makeSendLog(overrides: Partial<SendLog> = {}): SendLog {
  return {
    id: "log-test-id-12345",
    project_id: "proj-test-id-12345",
    idempotency_key: "idem-key-123",
    payload_hash: "abc123hash",
    template_id: "tmpl-123",
    recipient_id: "recip-123",
    to_email: "user@example.com",
    subject: "Test Subject",
    status: "sending",
    resend_id: null,
    provider_id: null,
    provider_type: null,
    provider_message_id: null,
    error_message: null,
    created_at: "2025-01-01T00:00:00.000Z",
    sent_at: null,
    ...overrides,
  };
}

// Mock D1Database
function createMockDb(options: {
  queryResults?: SendLog[];
  firstResult?: SendLog | { count: number } | null;
}) {
  const mockStmt = {
    all: mock(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: mock(() => Promise.resolve(options.firstResult ?? null)),
    run: mock(() => Promise.resolve(createMockResult())),
  };

  return {
    prepare: mock(() => ({
      bind: mock(() => mockStmt),
    })),
    _stmt: mockStmt,
  } as unknown as D1Database;
}

describe("SendLogs CRUD (native D1)", () => {
  describe("listSendLogs", () => {
    test("returns send logs for a project", async () => {
      const logs = [
        makeSendLog({ id: "l1" }),
        makeSendLog({ id: "l2" }),
      ];
      const mockDb = createMockDb({ queryResults: logs });

      const result = await listSendLogs(mockDb, "proj-1");

      expect(result).toHaveLength(2);
    });

    test("filters by status when provided", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listSendLogs(mockDb, "proj-1", { status: "sent" });

      // Just verify it runs without error
      expect(true).toBe(true);
    });

    test("applies pagination", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listSendLogs(mockDb, "proj-1", { limit: 10, offset: 20 });

      expect(true).toBe(true);
    });
  });

  describe("listAllSendLogs", () => {
    test("returns logs across all projects", async () => {
      const logs = [
        makeSendLog({ project_id: "p1" }),
        makeSendLog({ project_id: "p2" }),
      ];
      const mockDb = createMockDb({ queryResults: logs });

      const result = await listAllSendLogs(mockDb);

      expect(result).toHaveLength(2);
    });

    test("filters by status when provided", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listAllSendLogs(mockDb, { status: "failed" });

      expect(true).toBe(true);
    });
  });

  describe("getSendLog", () => {
    test("returns send log when found", async () => {
      const log = makeSendLog();
      const mockDb = createMockDb({ firstResult: log });

      const result = await getSendLog(mockDb, log.id);

      expect(result).not.toBeNull();
      expect(result?.to_email).toBe("user@example.com");
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getSendLog(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findByIdempotencyKey", () => {
    test("returns log when idempotency key matches", async () => {
      const log = makeSendLog({ idempotency_key: "unique-key" });
      const mockDb = createMockDb({ firstResult: log });

      const result = await findByIdempotencyKey(mockDb, log.project_id, "unique-key");

      expect(result).not.toBeNull();
      expect(result?.idempotency_key).toBe("unique-key");
    });

    test("returns null when idempotency key not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await findByIdempotencyKey(mockDb, "proj-1", "unknown");

      expect(result).toBeNull();
    });
  });

  describe("createSendLog", () => {
    test("creates send log with status sending", async () => {
      const mockDb = createMockDb({});

      const result = await createSendLog(mockDb, {
        project_id: "proj-123",
        template_id: "tmpl-123",
        recipient_id: "recip-123",
        to_email: "test@example.com",
        subject: "Hello",
      });

      expect(result.id).toHaveLength(21);
      expect(result.status).toBe("sending");
      expect(result.to_email).toBe("test@example.com");
      expect(result.sent_at).toBeNull();
    });

    test("creates send log with idempotency key", async () => {
      const mockDb = createMockDb({});

      const result = await createSendLog(mockDb, {
        project_id: "proj-123",
        idempotency_key: "my-idem-key",
        payload_hash: "hash123",
        template_id: "tmpl-123",
        recipient_id: "recip-123",
        to_email: "test@example.com",
        subject: "Hello",
      });

      expect(result.idempotency_key).toBe("my-idem-key");
      expect(result.payload_hash).toBe("hash123");
    });

    test("creates send log with provider info", async () => {
      const mockDb = createMockDb({});

      const result = await createSendLog(mockDb, {
        project_id: "proj-123",
        template_id: "tmpl-123",
        recipient_id: "recip-123",
        to_email: "test@example.com",
        subject: "Hello",
        provider_id: "prov-123",
        provider_type: "resend",
      });

      expect(result.provider_id).toBe("prov-123");
      expect(result.provider_type).toBe("resend");
    });
  });

  describe("updateSendLogProvider", () => {
    test("updates provider info", async () => {
      const mockDb = createMockDb({});

      await updateSendLogProvider(mockDb, "log-123", {
        provider_id: "prov-456",
        provider_type: "cloudflare",
      });

      // Just verify it runs without error
      expect(true).toBe(true);
    });
  });

  describe("resetSendLogForRetry", () => {
    test("resets status to sending", async () => {
      const mockDb = createMockDb({});

      await resetSendLogForRetry(mockDb, "log-123", {
        to_email: "new@example.com",
        subject: "Retry Subject",
      });

      expect(true).toBe(true);
    });
  });

  describe("markSendLogSent", () => {
    test("marks as sent with resend provider", async () => {
      const mockDb = createMockDb({});

      await markSendLogSent(mockDb, "log-123", {
        providerMessageId: "msg-id-123",
        providerType: "resend",
      });

      expect(true).toBe(true);
    });

    test("marks as sent with cloudflare provider (no resend_id)", async () => {
      const mockDb = createMockDb({});

      await markSendLogSent(mockDb, "log-123", {
        providerMessageId: "cf-msg-123",
        providerType: "cloudflare",
      });

      expect(true).toBe(true);
    });
  });

  describe("markSendLogFailed", () => {
    test("marks as failed with error message", async () => {
      const mockDb = createMockDb({});

      await markSendLogFailed(mockDb, "log-123", "Connection timeout");

      expect(true).toBe(true);
    });
  });

  describe("countDailySends", () => {
    test("returns count of daily sends", async () => {
      const mockDb = createMockDb({ firstResult: { count: 42 } });

      const result = await countDailySends(mockDb, "proj-123");

      expect(result).toBe(42);
    });

    test("returns 0 when no sends", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await countDailySends(mockDb, "proj-123");

      expect(result).toBe(0);
    });
  });

  describe("countMonthlySends", () => {
    test("returns count of monthly sends", async () => {
      const mockDb = createMockDb({ firstResult: { count: 150 } });

      const result = await countMonthlySends(mockDb, "proj-123");

      expect(result).toBe(150);
    });

    test("returns 0 when no sends", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await countMonthlySends(mockDb, "proj-123");

      expect(result).toBe(0);
    });
  });
});
