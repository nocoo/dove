import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, makeRecipient } from "./helpers";

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

describe("listRecipients", () => {
  test("queries by project_id", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([makeRecipient()]);
    });

    const { listRecipients } = await import("@/lib/db/recipients");
    const result = await listRecipients("proj_123");

    expect(result).toHaveLength(1);
    const body = JSON.parse(capturedBody) as { sql: string; params: string[] };
    expect(body.sql).toContain("WHERE project_id = ?");
    expect(body.params[0]).toBe("proj_123");
  });
});

describe("createRecipient", () => {
  test("normalizes email to lowercase", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([]);
    });

    const { createRecipient } = await import("@/lib/db/recipients");
    const result = await createRecipient({
      project_id: "proj_123",
      name: "Test",
      email: "  Test@Example.COM  ",
    });

    expect(result.email).toBe("test@example.com");
    const body = JSON.parse(capturedBody) as { params: unknown[] };
    expect(body.params).toContain("test@example.com");
  });
});

describe("getRecipient", () => {
  test("returns recipient when found", async () => {
    const recipient = makeRecipient();
    globalThis.fetch = mockFetch(async () => d1Success([recipient]));

    const { getRecipient } = await import("@/lib/db/recipients");
    const result = await getRecipient(recipient.id);
    expect(result?.id).toBe(recipient.id);
  });
});

describe("getRecipientByEmail", () => {
  test("normalizes email before query", async () => {
    const recipient = makeRecipient();
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = init?.body as string;
      return d1Success([recipient]);
    });

    const { getRecipientByEmail } = await import("@/lib/db/recipients");
    await getRecipientByEmail("proj_123", " TEST@example.com ");

    const body = JSON.parse(capturedBody) as { params: string[] };
    expect(body.params).toContain("test@example.com");
  });
});

describe("deleteRecipient", () => {
  test("deletes and returns true", async () => {
    const recipient = makeRecipient();
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount++;
      if (callCount === 1) return d1Success([recipient]); // getRecipient
      return d1Success([]); // DELETE
    });

    const { deleteRecipient } = await import("@/lib/db/recipients");
    const result = await deleteRecipient("rcpt_123");
    expect(result).toBe(true);
  });

  test("returns false when recipient not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { deleteRecipient } = await import("@/lib/db/recipients");
    const result = await deleteRecipient("nonexistent");
    expect(result).toBe(false);
  });
});

describe("updateRecipient", () => {
  test("updates name and normalizes email", async () => {
    const recipient = makeRecipient();
    let callCount = 0;
    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount++;
      capturedBody = init?.body as string;
      if (callCount === 1) return d1Success([recipient]); // getRecipient
      return d1Success([]); // UPDATE
    });

    const { updateRecipient } = await import("@/lib/db/recipients");
    const result = await updateRecipient(recipient.id, { name: "New Name", email: "New@Example.COM" });

    expect(result?.name).toBe("New Name");
    expect(result?.email).toBe("new@example.com");
  });

  test("returns undefined when recipient not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { updateRecipient } = await import("@/lib/db/recipients");
    const result = await updateRecipient("nonexistent", { name: "X" });
    expect(result).toBeUndefined();
  });
});
