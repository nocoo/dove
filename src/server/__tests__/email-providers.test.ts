/**
 * Tests for server-side EmailProvider CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
import {
  listEmailProviders,
  getEmailProvider,
  createEmailProvider,
  updateEmailProvider,
  deleteEmailProvider,
  countProjectsByProvider,
  type EmailProviderRecord,
} from "../lib/db/email-providers";

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
    all: vi.fn(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: vi.fn(() => Promise.resolve(options.firstResult ?? null)),
    run: vi.fn(() => Promise.resolve(createMockResult())),
  };
  const bindFn = vi.fn(() => mockStmt);

  return {
    prepare: vi.fn(() => ({
      bind: bindFn,
    })),
    _stmt: mockStmt,
    _bind: bindFn,
  } as unknown as D1Database & { _bind: typeof bindFn };
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
    test("returns provider when found AND pins WHERE id=? + id-bind (defends api_key disclosure via SQL swap)", async () => {
      const provider = makeProvider();
      const mockDb = createMockDb({ firstResult: provider });

      const result = await getEmailProvider(mockDb, provider.id);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Production Resend");
      expect(result?.type).toBe("resend");
      // SECURITY: getEmailProvider returns the FULL provider record
      // including the parsed config (which contains api_key for Resend
      // providers). A regression that changed the SQL filter from
      // `WHERE id = ?` to e.g. `WHERE name = ?` would let any caller
      // who knows a provider name read its api_key (the config column)
      // by passing the name where an id was expected. Pin SQL+bind.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(provider.id);
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getEmailProvider(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("createEmailProvider", () => {
    test("creates provider with generated ID and pins INSERT bind positions", async () => {
      const mockDb = createMockDb({}) as D1Database & { _bind: ReturnType<typeof vi.fn> };

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
      // Guard against silent no-INSERT (provider config + api_key lost).
      const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(sqlCalls.some((s) => /INSERT INTO email_providers/i.test(s))).toBe(true);
      // Bind order from src/server/lib/db/email-providers.ts:59:
      //  [id, name, type, domain, config, created_at, updated_at]
      // Critical swap: name↔domain. Both strings, both customer-shown.
      // A swap would put 'New Provider' as the SMTP-domain (sending email
      // would fail with DNS/MX errors) and 'example.com' as the provider
      // display name (dashboard label garbled). UNIQUE(type, domain)
      // would also fail-open: same domain re-added under different name.
      // Also pin type and config so a regression that wrote the API key
      // (in config) into the type column — leaking the secret into a
      // queryable enum field — is caught.
      const binds = mockDb._bind.mock.calls[0] as unknown[];
      expect(binds[1]).toBe("New Provider");                          // name
      expect(binds[2]).toBe("resend");                                // type
      expect(binds[3]).toBe("example.com");                            // domain (NOT name)
      expect(binds[4]).toBe(JSON.stringify({ api_key: "key123" }));   // config (api_key MUST land here)
    });

    test("creates cloudflare provider", async () => {
      const mockDb = createMockDb({});

      const result = await createEmailProvider(mockDb, {
        name: "CF Provider",
        type: "cloudflare",
        domain: "mail.example.com",
        config: JSON.stringify({}),
      });

      expect(result.type).toBe("cloudflare");
    });
  });

  describe("updateEmailProvider", () => {
    test("updates provider fields", async () => {
      const existing = makeProvider();
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult())),
      };
      const bindFn = vi.fn(() => mockStmt);
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: bindFn,
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
      // Guard against in-memory-only update: assert UPDATE actually issued.
      const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(sqlCalls.some((s) => /UPDATE email_providers/i.test(s))).toBe(true);
      // Pin UPDATE bind positions: [name, type, domain, config, updated_at, id].
      // bindFn.mock.calls[1] is the UPDATE bind (calls[0] is SELECT existing).
      // Critical: name↔domain swap would put 'Updated Name' as the SMTP
      // domain (sends fail with DNS errors) AND 'newdomain.com' as the
      // display name — in-memory result.* still passes (merged from input).
      const updateBinds = bindFn.mock.calls[1] as unknown[];
      expect(updateBinds[0]).toBe("Updated Name");          // name (NOT domain)
      expect(updateBinds[1]).toBe(existing.type);           // type unchanged
      expect(updateBinds[2]).toBe("newdomain.com");          // domain (NOT name)
      expect(updateBinds[3]).toBe(existing.config);         // config unchanged
      expect(updateBinds[5]).toBe(existing.id);             // WHERE id
    });

    test("updates config", async () => {
      const existing = makeProvider();
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => mockStmt),
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
      // Guard against silent no-delete: returning true without issuing
      // DELETE would leave provider configs (with secrets) lingering.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
      const deleteIdx = sqlCalls.findIndex((s) => /DELETE FROM email_providers/i.test(s));
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      // Pin the WHERE id bind on DELETE — wrong-variable regression
      // would leave provider configs (with secrets) lingering or delete
      // the wrong provider row entirely.
      const bindMock = (prepareMock.mock.results[deleteIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(existing.id);
    });

    test("returns false when provider not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteEmailProvider(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("countProjectsByProvider", () => {
    test("returns count of projects using provider AND pins WHERE provider_id bind", async () => {
      const mockDb = createMockDb({ firstResult: { count: 3 } });

      const result = await countProjectsByProvider(mockDb, "prov-distinct");

      expect(result).toBe(3);
      // This count GATES the destructive DELETE provider operation.
      // A regression that:
      //  (a) drops WHERE provider_id → counts ALL projects, blocks
      //      deletion of UNUSED providers (annoying);
      //  (b) binds the wrong variable / hardcoded id → may silently
      //      allow deletion of an IN-USE provider — orphaning every
      //      project that referenced it (sends start failing because
      //      provider lookup returns null mid-pipeline).
      // The mock returns count=3 regardless of input — the existing
      // test would silently pass either regression.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+provider_id\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe("prov-distinct");
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
