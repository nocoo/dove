/**
 * Tests for server-side WebhookLog CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
import {
  listWebhookLogs,
  listAllWebhookLogs,
  createWebhookLog,
  type WebhookLog,
} from "../lib/db/webhook-logs";

// Create a vi D1Result
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

// Sample webhook log fixture
function makeWebhookLog(overrides: Partial<WebhookLog> = {}): WebhookLog {
  return {
    id: "wlog-test-id-12345",
    project_id: "proj-test-id-12345",
    method: "POST",
    path: "/api/webhook/proj-123/send",
    status_code: 200,
    error_code: null,
    error_message: null,
    duration_ms: 150,
    ip: "127.0.0.1",
    user_agent: "curl/7.68.0",
    created_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mock D1Database
function createMockDb(options: { queryResults?: WebhookLog[] }) {
  const mockStmt = {
    all: vi.fn(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: vi.fn(() => Promise.resolve(null)),
    run: vi.fn(() => Promise.resolve(createMockResult())),
  };

  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => mockStmt),
    })),
    _stmt: mockStmt,
  } as unknown as D1Database;
}

describe("WebhookLogs CRUD (native D1)", () => {
  describe("listWebhookLogs", () => {
    test("returns webhook logs for a project", async () => {
      const logs = [
        makeWebhookLog({ id: "w1", status_code: 200 }),
        makeWebhookLog({ id: "w2", status_code: 400 }),
      ];
      const mockDb = createMockDb({ queryResults: logs });

      const result = await listWebhookLogs(mockDb, "proj-1");

      expect(result).toHaveLength(2);
      expect(result[0]!.status_code).toBe(200);
    });

    test("returns empty array when no logs", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      const result = await listWebhookLogs(mockDb, "proj-1");

      expect(result).toEqual([]);
    });

    test("applies pagination (pin LIMIT/OFFSET positions, not just presence)", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listWebhookLogs(mockDb, "proj-1", { limit: 25, offset: 50 });

      // limit↔offset swap would silently return the wrong page — a UI
      // showing 'page 3 of 5' would actually be page 2 (or worse, an
      // empty page if offset > totalRows). Pre-strengthening, the test
      // used toContain(25)+toContain(50) which a swap would still pass.
      // SQL: 'WHERE project_id = ? ORDER BY ... LIMIT ? OFFSET ?'
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe("proj-1"); // project_id
      expect(binds[1]).toBe(25);         // LIMIT (NOT offset)
      expect(binds[2]).toBe(50);         // OFFSET (NOT limit)
    });
  });

  describe("listAllWebhookLogs", () => {
    test("returns logs across all projects", async () => {
      const logs = [
        makeWebhookLog({ project_id: "p1" }),
        makeWebhookLog({ project_id: "p2" }),
      ];
      const mockDb = createMockDb({ queryResults: logs });

      const result = await listAllWebhookLogs(mockDb);

      expect(result).toHaveLength(2);
    });

    test("applies pagination (pin LIMIT/OFFSET positions for listAll)", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      // Distinct values — limit (100) clearly differs from offset (0).
      // For listAll there's no projectId binding, so binds = [limit, offset].
      await listAllWebhookLogs(mockDb, { limit: 100, offset: 0 });

      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(100);  // LIMIT
      expect(binds[1]).toBe(0);     // OFFSET
    });
  });

  describe("createWebhookLog", () => {
    test("creates log with required fields", async () => {
      const mockDb = createMockDb({});

      await createWebhookLog(mockDb, {
        project_id: "proj-123",
        method: "POST",
        path: "/api/webhook/proj-123/send",
        status_code: 200,
      });

      // Was a no-op assertion. Webhook logs MUST persist on every request
      // (audit trail / debugging / per-project request counts) so a
      // silent no-INSERT is the worst regression here.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const stmt = prepareMock.mock.calls
        .map((c) => c[0] as string)
        .find((s) => /INSERT INTO webhook_logs/i.test(s));
      expect(stmt).toBeDefined();
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const bound = bindMock?.mock.calls.flat() ?? [];
      expect(bound).toContain("proj-123");
      expect(bound).toContain("POST");
      expect(bound).toContain(200);
      // Optional fields default to null, not empty string (NULL is
      // semantically distinct in SQL aggregates and important downstream).
      expect(bound).toContain(null);
      // Pin REQUIRED-only INSERT bind positions. Bind order:
      //  [id, project_id, method, path, status_code, error_code,
      //   error_message, duration_ms, ip, user_agent, created_at]
      // A regression that bound `path` into status_code (e.g. swapped
      // path↔status_code in argument order) would silently log every
      // webhook with status='/api/webhook/proj-123/send' — toContain()
      // alone passes because both values are 'present somewhere'.
      const binds = bound as unknown[];
      expect(binds[1]).toBe("proj-123");
      expect(binds[2]).toBe("POST");
      expect(binds[3]).toBe("/api/webhook/proj-123/send");
      expect(binds[4]).toBe(200);
      // Optional fields all null in default branch.
      expect(binds[5]).toBeNull(); // error_code
      expect(binds[6]).toBeNull(); // error_message
      expect(binds[7]).toBeNull(); // duration_ms
      expect(binds[8]).toBeNull(); // ip
      expect(binds[9]).toBeNull(); // user_agent
    });

    test("creates log with all optional fields", async () => {
      const mockDb = createMockDb({});

      await createWebhookLog(mockDb, {
        project_id: "proj-123",
        method: "POST",
        path: "/api/webhook/proj-123/send",
        status_code: 500,
        error_code: "internal_error",
        error_message: "Something went wrong",
        duration_ms: 250,
        ip: "192.168.1.1",
        user_agent: "TestClient/1.0",
      });

      // Verify ALL optional fields are forwarded (a regression that drops
      // any one would lose audit context: who hit us, from where, why
      // it failed).
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const bound = bindMock?.mock.calls.flat() ?? [];
      expect(bound).toContain("internal_error");
      expect(bound).toContain("Something went wrong");
      expect(bound).toContain(250);
      expect(bound).toContain("192.168.1.1");
      expect(bound).toContain("TestClient/1.0");
      // Pin bind POSITIONS — toContain() above only proves "present
      // somewhere". Bind order from src/server/lib/db/webhook-logs.ts:86:
      //  [id, project_id, method, path, status_code, error_code,
      //   error_message, duration_ms, ip, user_agent, created_at]
      // High-risk swap pairs:
      //  - error_code↔error_message: dashboard error-grouping breaks
      //    (groups by code; full message in code field would explode
      //    cardinality).
      //  - ip↔user_agent: would log UA as IP — abuse-rate-limiting and
      //    geo-analytics break, plus PII leakage class shifts.
      const binds = bound as unknown[];
      expect(binds[1]).toBe("proj-123");                  // project_id
      expect(binds[2]).toBe("POST");                       // method
      expect(binds[3]).toBe("/api/webhook/proj-123/send"); // path
      expect(binds[4]).toBe(500);                          // status_code
      expect(binds[5]).toBe("internal_error");             // error_code
      expect(binds[6]).toBe("Something went wrong");       // error_message
      expect(binds[7]).toBe(250);                          // duration_ms
      expect(binds[8]).toBe("192.168.1.1");                // ip (NOT UA)
      expect(binds[9]).toBe("TestClient/1.0");             // user_agent (NOT IP)
    });

    test("creates log for error response", async () => {
      const mockDb = createMockDb({});

      await createWebhookLog(mockDb, {
        project_id: "proj-123",
        method: "POST",
        path: "/api/webhook/proj-123/send",
        status_code: 401,
        error_code: "unauthorized",
        error_message: "Invalid bearer token",
      });

      // Error rows MUST capture status_code + error_code + error_message
      // — the audit trail's whole purpose. Plus we'd want to know that
      // a 401 was actually recorded as 401 (not coerced to 200).
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const bound = bindMock?.mock.calls.flat() ?? [];
      expect(bound).toContain(401);
      expect(bound).toContain("unauthorized");
      expect(bound).toContain("Invalid bearer token");
    });
  });
});
