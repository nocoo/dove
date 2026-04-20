/**
 * Tests for server-side EmailProvider CRUD operations with native D1 binding.
 */
import { describe, expect, test, mock } from "bun:test";
import {
  listEmailProviders,
  getEmailProvider,
  createEmailProvider,
  updateEmailProvider,
  deleteEmailProvider,
  countProjectsByProvider,
  type EmailProviderRecord,
} from "../lib/db/email-providers";

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

// Sample email provider fixture
function makeProvider(overrides: Partial<EmailProviderRecord> = {}): EmailProviderRecord {
  return {
    id: "prov-test-id-12345",
    name: "Production Resend",
    type: "resend",
    domain: "hexly.ai",
    config: JSON.stringify({ api_key: "re_test_xxx" }),
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mock D1Database
function createMockDb(options: {
  queryResults?: EmailProviderRecord[];
  firstResult?: EmailProviderRecord | { count: number } | null;
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

describe("EmailProviders CRUD (native D1)", () => {
  describe("listEmailProviders", () => {
    test("returns all providers", async () => {
      const providers = [
        makeProvider({ id: "p1", name: "Resend Prod" }),
        makeProvider({ id: "p2", name: "Cloudflare Dev", type: "cloudflare" }),
      ];
      const mockDb = createMockDb({ queryResults: providers });

      const result = await listEmailProviders(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Resend Prod");
    });

    test("returns empty array when no providers", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      const result = await listEmailProviders(mockDb);

      expect(result).toEqual([]);
    });
  });

  describe("getEmailProvider", () => {
    test("returns provider when found", async () => {
      const provider = makeProvider();
      const mockDb = createMockDb({ firstResult: provider });

      const result = await getEmailProvider(mockDb, provider.id);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Production Resend");
      expect(result?.type).toBe("resend");
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getEmailProvider(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("createEmailProvider", () => {
    test("creates provider with generated ID", async () => {
      const mockDb = createMockDb({});

      const result = await createEmailProvider(mockDb, {
        name: "New Provider",
        type: "resend",
        domain: "example.com",
        config: JSON.stringify({ api_key: "key123" }),
      });

      expect(result.id).toHaveLength(21);
      expect(result.name).toBe("New Provider");
      expect(result.type).toBe("resend");
      expect(result.domain).toBe("example.com");
    });

    test("creates cloudflare provider", async () => {
      const mockDb = createMockDb({});

      const result = await createEmailProvider(mockDb, {
        name: "CF Provider",
        type: "cloudflare",
        domain: "mail.example.com",
        config: JSON.stringify({ worker_url: "https://email.workers.dev" }),
      });

      expect(result.type).toBe("cloudflare");
    });
  });

  describe("updateEmailProvider", () => {
    test("updates provider fields", async () => {
      const existing = makeProvider();
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

      const result = await updateEmailProvider(mockDb, existing.id, {
        name: "Updated Name",
        domain: "newdomain.com",
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Updated Name");
      expect(result?.domain).toBe("newdomain.com");
      expect(result?.type).toBe(existing.type);
    });

    test("updates config", async () => {
      const existing = makeProvider();
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

      const newConfig = JSON.stringify({ api_key: "new_key_xxx" });
      const result = await updateEmailProvider(mockDb, existing.id, {
        config: newConfig,
      });

      expect(result?.config).toBe(newConfig);
    });

    test("returns null when provider not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await updateEmailProvider(mockDb, "nonexistent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteEmailProvider", () => {
    test("deletes existing provider", async () => {
      const existing = makeProvider();
      const mockDb = createMockDb({ firstResult: existing });

      const result = await deleteEmailProvider(mockDb, existing.id);

      expect(result).toBe(true);
    });

    test("returns false when provider not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteEmailProvider(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("countProjectsByProvider", () => {
    test("returns count of projects using provider", async () => {
      const mockDb = createMockDb({ firstResult: { count: 3 } });

      const result = await countProjectsByProvider(mockDb, "prov-123");

      expect(result).toBe(3);
    });

    test("returns 0 when no projects use provider", async () => {
      const mockDb = createMockDb({ firstResult: { count: 0 } });

      const result = await countProjectsByProvider(mockDb, "prov-123");

      expect(result).toBe(0);
    });

    test("returns 0 when count query returns null", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await countProjectsByProvider(mockDb, "prov-123");

      expect(result).toBe(0);
    });
  });
});
