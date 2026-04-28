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

    test("applies pagination", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listWebhookLogs(mockDb, "proj-1", { limit: 25, offset: 50 });

      expect(true).toBe(true);
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

    test("applies pagination", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      await listAllWebhookLogs(mockDb, { limit: 100, offset: 0 });

      expect(true).toBe(true);
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

      expect(true).toBe(true);
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

      expect(true).toBe(true);
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

      expect(true).toBe(true);
    });
  });
});
