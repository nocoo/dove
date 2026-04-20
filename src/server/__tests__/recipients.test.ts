/**
 * Tests for server-side Recipient CRUD operations with native D1 binding.
 */
import { describe, expect, test, mock } from "bun:test";
import {
  listRecipients,
  getRecipient,
  getRecipientByEmail,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  normalizeEmail,
  type Recipient,
} from "../lib/db/recipients";

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

// Sample recipient fixture
function makeRecipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: "recip-test-id-12345",
    project_id: "proj-test-id-12345",
    name: "John Doe",
    email: "john@example.com",
    created_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mock D1Database
function createMockDb(options: {
  queryResults?: Recipient[];
  firstResult?: Recipient | null;
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

describe("Recipients CRUD (native D1)", () => {
  describe("normalizeEmail", () => {
    test("trims and lowercases email", () => {
      expect(normalizeEmail("  John@Example.COM  ")).toBe("john@example.com");
    });

    test("handles already normalized email", () => {
      expect(normalizeEmail("test@example.com")).toBe("test@example.com");
    });
  });

  describe("listRecipients", () => {
    test("returns all recipients for a project", async () => {
      const recipients = [
        makeRecipient({ id: "r1", name: "Alice" }),
        makeRecipient({ id: "r2", name: "Bob" }),
      ];
      const mockDb = createMockDb({ queryResults: recipients });

      const result = await listRecipients(mockDb, "proj-1");

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Alice");
    });

    test("returns empty array when no recipients", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      const result = await listRecipients(mockDb, "proj-1");

      expect(result).toEqual([]);
    });
  });

  describe("getRecipient", () => {
    test("returns recipient when found", async () => {
      const recipient = makeRecipient();
      const mockDb = createMockDb({ firstResult: recipient });

      const result = await getRecipient(mockDb, recipient.id);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("John Doe");
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getRecipient(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getRecipientByEmail", () => {
    test("returns recipient when email matches", async () => {
      const recipient = makeRecipient();
      const mockDb = createMockDb({ firstResult: recipient });

      const result = await getRecipientByEmail(
        mockDb,
        recipient.project_id,
        recipient.email,
      );

      expect(result).not.toBeNull();
      expect(result?.email).toBe(recipient.email);
    });

    test("normalizes email before lookup", async () => {
      const recipient = makeRecipient({ email: "john@example.com" });
      const mockDb = createMockDb({ firstResult: recipient });

      const result = await getRecipientByEmail(
        mockDb,
        recipient.project_id,
        "  JOHN@EXAMPLE.COM  ",
      );

      expect(result).not.toBeNull();
    });

    test("returns null when email not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getRecipientByEmail(
        mockDb,
        "proj-1",
        "unknown@example.com",
      );

      expect(result).toBeNull();
    });
  });

  describe("createRecipient", () => {
    test("creates recipient with generated ID", async () => {
      const mockDb = createMockDb({});

      const result = await createRecipient(mockDb, {
        project_id: "proj-123",
        name: "Jane Smith",
        email: "jane@example.com",
      });

      expect(result.id).toHaveLength(21);
      expect(result.name).toBe("Jane Smith");
      expect(result.email).toBe("jane@example.com");
      expect(result.project_id).toBe("proj-123");
    });

    test("normalizes email on create", async () => {
      const mockDb = createMockDb({});

      const result = await createRecipient(mockDb, {
        project_id: "proj-123",
        name: "Test",
        email: "  TEST@EXAMPLE.COM  ",
      });

      expect(result.email).toBe("test@example.com");
    });
  });

  describe("updateRecipient", () => {
    test("updates recipient fields", async () => {
      const existing = makeRecipient();
      let callCount = 0;
      const mockStmt = {
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateRecipient(mockDb, existing.id, {
        name: "Updated Name",
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Updated Name");
      expect(result?.email).toBe(existing.email);
    });

    test("normalizes email on update", async () => {
      const existing = makeRecipient();
      let callCount = 0;
      const mockStmt = {
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateRecipient(mockDb, existing.id, {
        email: "  NEW@EXAMPLE.COM  ",
      });

      expect(result?.email).toBe("new@example.com");
    });

    test("returns null when recipient not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await updateRecipient(mockDb, "nonexistent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteRecipient", () => {
    test("deletes existing recipient", async () => {
      const existing = makeRecipient();
      const mockDb = createMockDb({ firstResult: existing });

      const result = await deleteRecipient(mockDb, existing.id);

      expect(result).toBe(true);
    });

    test("returns false when recipient not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteRecipient(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });
});
