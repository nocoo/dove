import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success } from "./helpers";
import type { EmailProviderRecord } from "@/lib/db/email-providers";

let originalFetch: typeof globalThis.fetch;

function makeProviderRecord(
  overrides: Partial<EmailProviderRecord> = {},
): EmailProviderRecord {
  return {
    id: "prov_test12345678a",
    name: "Main Resend",
    type: "resend",
    domain: "mail.example.com",
    config: JSON.stringify({ api_key: "re_live_1234567890abcdef" }),
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

function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

/**
 * Build a fetch handler that routes queries by a regex-based SQL dispatch.
 * Each handler receives the parsed D1 proxy body and returns a Response.
 */
function routeFetch(
  handlers: Array<{
    match: RegExp;
    respond: (body: { sql: string; params?: unknown[] }) => Response;
  }>,
): typeof globalThis.fetch {
  return mockFetch(async (_input, init) => {
    const body = JSON.parse(init?.body as string) as {
      sql: string;
      params?: unknown[];
    };
    for (const h of handlers) {
      if (h.match.test(body.sql)) return h.respond(body);
    }
    throw new Error(`Unexpected SQL: ${body.sql}`);
  });
}

// ---------------------------------------------------------------------------
// GET /api/providers
// ---------------------------------------------------------------------------

describe("GET /api/providers", () => {
  test("returns sanitized providers", async () => {
    globalThis.fetch = routeFetch([
      { match: /SELECT \* FROM email_providers/i, respond: () => d1Success([makeProviderRecord()]) },
    ]);
    const { GET } = await import("@/app/api/providers/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ config: Record<string, string> }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.config["api_key"]).toBe("••••••cdef");
  });

  test("returns 500 on db error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("boom");
    });
    const { GET } = await import("@/app/api/providers/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/providers
// ---------------------------------------------------------------------------

describe("POST /api/providers", () => {
  test("creates and returns sanitized provider", async () => {
    let insertedParams: unknown[] = [];
    globalThis.fetch = routeFetch([
      {
        match: /INSERT INTO email_providers/i,
        respond: (b) => {
          insertedParams = b.params ?? [];
          return d1Success([]);
        },
      },
    ]);
    const { POST } = await import("@/app/api/providers/route");
    const res = await POST(
      jsonRequest("http://localhost/api/providers", "POST", {
        name: "New Provider",
        type: "cloudflare",
        domain: "mail.example.com",
        config: {
          api_key: "cf_secret_1234",
          worker_url: "https://w.example.com",
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      type: string;
      config: Record<string, string>;
    };
    expect(body.type).toBe("cloudflare");
    // config is masked
    expect(body.config["api_key"]).toBe("••••••1234");
    expect(body.config["worker_url"]).toBe("https://w.example.com");
    // config stored as JSON string; 5th param = config
    expect(insertedParams[4]).toBe(
      JSON.stringify({
        api_key: "cf_secret_1234",
        worker_url: "https://w.example.com",
      }),
    );
  });

  test("rejects invalid body", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { POST } = await import("@/app/api/providers/route");
    const res = await POST(
      jsonRequest("http://localhost/api/providers", "POST", {
        name: "",
        type: "invalid",
        domain: "",
        config: {},
      }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 500 on db error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("boom");
    });
    const { POST } = await import("@/app/api/providers/route");
    const res = await POST(
      jsonRequest("http://localhost/api/providers", "POST", {
        name: "X",
        type: "resend",
        domain: "mail.example.com",
        config: { api_key: "re_abc" },
      }),
    );
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/providers/[id]
// ---------------------------------------------------------------------------

describe("GET /api/providers/[id]", () => {
  test("returns sanitized provider when found", async () => {
    globalThis.fetch = routeFetch([
      { match: /SELECT \* FROM email_providers WHERE id/i, respond: () => d1Success([makeProviderRecord()]) },
    ]);
    const { GET } = await import("@/app/api/providers/[id]/route");
    const res = await GET(jsonRequest("http://x/api/providers/prov_1", "GET"), {
      params: Promise.resolve({ id: "prov_1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: Record<string, string> };
    expect(body.config["api_key"]).toBe("••••••cdef");
  });

  test("returns 404 when missing", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { GET } = await import("@/app/api/providers/[id]/route");
    const res = await GET(jsonRequest("http://x/api/providers/none", "GET"), {
      params: Promise.resolve({ id: "none" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 500 on error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("boom");
    });
    const { GET } = await import("@/app/api/providers/[id]/route");
    const res = await GET(jsonRequest("http://x/api/providers/prov", "GET"), {
      params: Promise.resolve({ id: "prov" }),
    });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/providers/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/providers/[id]", () => {
  test("updates and returns sanitized provider", async () => {
    let updateParams: unknown[] = [];
    globalThis.fetch = routeFetch([
      { match: /^SELECT \* FROM email_providers/i, respond: () => d1Success([makeProviderRecord()]) },
      {
        match: /^UPDATE email_providers/i,
        respond: (b) => {
          updateParams = b.params ?? [];
          return d1Success([]);
        },
      },
    ]);
    const { PUT } = await import("@/app/api/providers/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/providers/prov_1", "PUT", {
        name: "Renamed",
        config: { api_key: "re_new_abcdwxyz" },
      }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      config: Record<string, string>;
    };
    expect(body.name).toBe("Renamed");
    // 1=name,2=type,3=domain,4=config (updated to new JSON)
    expect(updateParams[0]).toBe("Renamed");
    expect(updateParams[3]).toBe(JSON.stringify({ api_key: "re_new_abcdwxyz" }));
    expect(body.config["api_key"]).toBe("••••••wxyz");
  });

  test("keeps config unchanged when omitted", async () => {
    const original = makeProviderRecord();
    let updateParams: unknown[] = [];
    globalThis.fetch = routeFetch([
      { match: /^SELECT \* FROM email_providers/i, respond: () => d1Success([original]) },
      {
        match: /^UPDATE email_providers/i,
        respond: (b) => {
          updateParams = b.params ?? [];
          return d1Success([]);
        },
      },
    ]);
    const { PUT } = await import("@/app/api/providers/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/providers/prov_1", "PUT", { name: "New" }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(200);
    // config param preserved from existing record
    expect(updateParams[3]).toBe(original.config);
  });

  test("returns 404 when missing", async () => {
    globalThis.fetch = routeFetch([
      { match: /^SELECT \* FROM email_providers/i, respond: () => d1Success([]) },
    ]);
    const { PUT } = await import("@/app/api/providers/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/providers/none", "PUT", { name: "y" }),
      { params: Promise.resolve({ id: "none" }) },
    );
    expect(res.status).toBe(404);
  });

  test("rejects invalid payload", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { PUT } = await import("@/app/api/providers/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/providers/prov_1", "PUT", { name: "" }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(400);
  });

  test("returns 500 on error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("boom");
    });
    const { PUT } = await import("@/app/api/providers/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/providers/prov_1", "PUT", { name: "ok" }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/providers/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/providers/[id]", () => {
  test("blocks delete when provider in use (409 provider_in_use)", async () => {
    globalThis.fetch = routeFetch([
      { match: /SELECT COUNT\(\*\).*FROM projects/i, respond: () => d1Success([{ count: 2 }]) },
    ]);
    const { DELETE } = await import("@/app/api/providers/[id]/route");
    const res = await DELETE(
      jsonRequest("http://x/api/providers/prov_1", "DELETE"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("provider_in_use");
    expect(body.error.message).toContain("2");
  });

  test("returns 404 when not found", async () => {
    globalThis.fetch = routeFetch([
      { match: /SELECT COUNT\(\*\).*FROM projects/i, respond: () => d1Success([{ count: 0 }]) },
      { match: /^SELECT \* FROM email_providers/i, respond: () => d1Success([]) },
    ]);
    const { DELETE } = await import("@/app/api/providers/[id]/route");
    const res = await DELETE(
      jsonRequest("http://x/api/providers/none", "DELETE"),
      { params: Promise.resolve({ id: "none" }) },
    );
    expect(res.status).toBe(404);
  });

  test("deletes and returns 204", async () => {
    let deletedId: unknown;
    globalThis.fetch = routeFetch([
      { match: /SELECT COUNT\(\*\).*FROM projects/i, respond: () => d1Success([{ count: 0 }]) },
      { match: /^SELECT \* FROM email_providers/i, respond: () => d1Success([makeProviderRecord()]) },
      {
        match: /^DELETE FROM email_providers/i,
        respond: (b) => {
          deletedId = b.params?.[0];
          return d1Success([]);
        },
      },
    ]);
    const { DELETE } = await import("@/app/api/providers/[id]/route");
    const res = await DELETE(
      jsonRequest("http://x/api/providers/prov_1", "DELETE"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(204);
    expect(deletedId).toBe("prov_1");
  });

  test("returns 500 on error", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("boom");
    });
    const { DELETE } = await import("@/app/api/providers/[id]/route");
    const res = await DELETE(
      jsonRequest("http://x/api/providers/prov_1", "DELETE"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(500);
  });
});
