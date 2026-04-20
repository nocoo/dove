/**
 * Tests for D1 native binding wrapper.
 */
import { describe, expect, test, mock } from "bun:test";
import { query, queryOne, execute, batch } from "../lib/db/d1";

// Create a mock D1Result for testing
function createMockResult(overrides: { changes?: number; last_row_id?: number } = {}): D1Result {
  return {
    success: true,
    meta: {
      duration: 1,
      changes: overrides.changes ?? 0,
      last_row_id: overrides.last_row_id ?? 0,
      rows_read: 0,
      rows_written: 0,
      size_after: 0,
      changed_db: false,
    },
    results: [],
  } as unknown as D1Result;
}

// Mock D1Database
function createMockDb(options: {
  allResults?: unknown[];
  firstResult?: unknown;
  runResult?: { changes?: number; last_row_id?: number };
  batchResults?: D1Result[];
} = {}) {
  const mockStmt = {
    all: mock(() => Promise.resolve({ results: options.allResults ?? [] })),
    first: mock(() => Promise.resolve(options.firstResult ?? null)),
    run: mock(() => Promise.resolve(createMockResult(options.runResult))),
  };

  const mockPrepare = mock(() => ({
    bind: mock(() => mockStmt),
  }));

  const mockBatch = mock(() => Promise.resolve(
    options.batchResults ?? [createMockResult()]
  ));

  return {
    prepare: mockPrepare,
    batch: mockBatch,
    _stmt: mockStmt,
    _prepare: mockPrepare,
  } as unknown as D1Database & { _stmt: typeof mockStmt; _prepare: typeof mockPrepare };
}

describe("D1 wrapper", () => {
  describe("query", () => {
    test("returns all rows from SELECT", async () => {
      const mockDb = createMockDb({
        allResults: [
          { id: "1", name: "Project A" },
          { id: "2", name: "Project B" },
        ],
      });

      const results = await query<{ id: string; name: string }>(
        mockDb,
        "SELECT * FROM projects WHERE active = ?",
        [true],
      );

      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe("Project A");
      expect(mockDb._prepare).toHaveBeenCalledTimes(1);
    });

    test("returns empty array when no rows match", async () => {
      const mockDb = createMockDb({ allResults: [] });

      const results = await query(mockDb, "SELECT * FROM projects WHERE id = ?", ["nonexistent"]);

      expect(results).toEqual([]);
    });
  });

  describe("queryOne", () => {
    test("returns first matching row", async () => {
      const mockDb = createMockDb({
        firstResult: { id: "1", name: "Project A" },
      });

      const result = await queryOne<{ id: string; name: string }>(
        mockDb,
        "SELECT * FROM projects WHERE id = ?",
        ["1"],
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Project A");
    });

    test("returns null when no row matches", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await queryOne(mockDb, "SELECT * FROM projects WHERE id = ?", ["nonexistent"]);

      expect(result).toBeNull();
    });
  });

  describe("execute", () => {
    test("executes INSERT and returns result", async () => {
      const mockDb = createMockDb({
        runResult: { changes: 1, last_row_id: 42 },
      });

      const result = await execute(
        mockDb,
        "INSERT INTO projects (id, name) VALUES (?, ?)",
        ["new-id", "New Project"],
      );

      expect(result.success).toBe(true);
      expect(result.meta.changes).toBe(1);
    });

    test("executes UPDATE and returns affected rows", async () => {
      const mockDb = createMockDb({
        runResult: { changes: 3, last_row_id: 0 },
      });

      const result = await execute(
        mockDb,
        "UPDATE projects SET active = ? WHERE archived = ?",
        [false, true],
      );

      expect(result.meta.changes).toBe(3);
    });

    test("executes DELETE and returns affected rows", async () => {
      const mockDb = createMockDb({
        runResult: { changes: 5, last_row_id: 0 },
      });

      const result = await execute(
        mockDb,
        "DELETE FROM projects WHERE created_at < ?",
        ["2020-01-01"],
      );

      expect(result.meta.changes).toBe(5);
    });
  });

  describe("batch", () => {
    test("executes multiple statements in single round-trip", async () => {
      const mockDb = createMockDb({
        batchResults: [
          createMockResult(),
          createMockResult(),
        ],
      });

      const results = await batch(mockDb, [
        { sql: "INSERT INTO projects (id, name) VALUES (?, ?)", params: ["1", "A"] },
        { sql: "INSERT INTO projects (id, name) VALUES (?, ?)", params: ["2", "B"] },
      ]);

      expect(results).toHaveLength(2);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
    });

    test("handles statements without params", async () => {
      const mockDb = createMockDb({
        batchResults: [createMockResult()],
      });

      const results = await batch(mockDb, [
        { sql: "DELETE FROM sessions WHERE expires_at < datetime('now')" },
      ]);

      expect(results).toHaveLength(1);
    });
  });
});
