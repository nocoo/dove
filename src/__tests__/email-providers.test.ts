import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success } from "./helpers";
import type { EmailProviderRecord } from "@/lib/db/email-providers";

let originalFetch: typeof globalThis.fetch;
let capturedBody = "";

function makeProviderRecord(
  overrides: Partial<EmailProviderRecord> = {},
): EmailProviderRecord {
  return {
    id: "prov_test12345678a",
    name: "Test Provider",
    type: "resend",
    domain: "example.com",
    config: JSON.stringify({ api_key: "re_test" }),
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

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

describe("listEmailProviders", () => {
  test("returns providers ordered by created_at desc", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([makeProviderRecord()]);
    });

    const { listEmailProviders } = await import("@/lib/db/email-providers");
    const rows = await listEmailProviders();

    expect(rows).toHaveLength(1);
    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).toContain("FROM email_providers");
    expect(body.sql).toContain("ORDER BY created_at DESC");
  });
});

describe("getEmailProvider", () => {
  test("returns the matching provider", async () => {
    globalThis.fetch = mockFetch(async () =>
      d1Success([makeProviderRecord()]),
    );
    const { getEmailProvider } = await import("@/lib/db/email-providers");
    const result = await getEmailProvider("prov_test12345678a");
    expect(result?.id).toBe("prov_test12345678a");
  });

  test("returns undefined when not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { getEmailProvider } = await import("@/lib/db/email-providers");
    expect(await getEmailProvider("missing")).toBeUndefined();
  });
});

describe("createEmailProvider", () => {
  test("inserts and returns the new row", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createEmailProvider } = await import("@/lib/db/email-providers");
    const result = await createEmailProvider({
      name: "Resend main",
      type: "resend",
      domain: "mail.example.com",
      config: JSON.stringify({ api_key: "re_abc" }),
    });

    expect(result.id).toHaveLength(21);
    expect(result.type).toBe("resend");
    const body = JSON.parse(capturedBody) as { sql: string; params: unknown[] };
    expect(body.sql).toContain("INSERT INTO email_providers");
    expect(body.params).toContain("mail.example.com");
  });
});

describe("updateEmailProvider", () => {
  test("no-ops and returns undefined when missing", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { updateEmailProvider } = await import("@/lib/db/email-providers");
    const result = await updateEmailProvider("missing", { name: "x" });
    expect(result).toBeUndefined();
  });

  test("updates only provided fields", async () => {
    const existing = makeProviderRecord({ name: "Old" });
    let updateCalled = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { sql: string; params: unknown[] };
      if (body.sql.startsWith("SELECT")) return d1Success([existing]);
      updateCalled = true;
      expect(body.params).toContain("New name");
      return d1Success([]);
    });

    const { updateEmailProvider } = await import("@/lib/db/email-providers");
    const result = await updateEmailProvider(existing.id, { name: "New name" });

    expect(updateCalled).toBe(true);
    expect(result?.name).toBe("New name");
    expect(result?.domain).toBe(existing.domain);
  });
});

describe("deleteEmailProvider", () => {
  test("returns false when missing", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { deleteEmailProvider } = await import("@/lib/db/email-providers");
    expect(await deleteEmailProvider("missing")).toBe(false);
  });

  test("deletes the row and returns true", async () => {
    const existing = makeProviderRecord();
    let deleted = false;
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { sql: string };
      if (body.sql.startsWith("SELECT")) return d1Success([existing]);
      if (body.sql.startsWith("DELETE")) deleted = true;
      return d1Success([]);
    });

    const { deleteEmailProvider } = await import("@/lib/db/email-providers");
    expect(await deleteEmailProvider(existing.id)).toBe(true);
    expect(deleted).toBe(true);
  });
});

describe("countProjectsByProvider", () => {
  test("returns the count", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([{ count: 3 }]);
    });
    const { countProjectsByProvider } = await import(
      "@/lib/db/email-providers"
    );
    const n = await countProjectsByProvider("prov_1");
    expect(n).toBe(3);
    const body = JSON.parse(capturedBody) as { sql: string };
    expect(body.sql).toContain("SELECT COUNT(*)");
    expect(body.sql).toContain("FROM projects");
    expect(body.sql).toContain("WHERE provider_id = ?");
  });

  test("returns 0 when no rows", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { countProjectsByProvider } = await import(
      "@/lib/db/email-providers"
    );
    expect(await countProjectsByProvider("prov_none")).toBe(0);
  });
});
