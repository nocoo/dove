import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";
import { mockFetch, d1Success } from "./helpers";
import type { EmailProviderRecord } from "@/lib/db/email-providers";

// ---------------------------------------------------------------------------
// Mock @/auth — every test in this file assumes a signed-in admin. Individual
// tests flip the return value to exercise the 401 path.
// ---------------------------------------------------------------------------
let mockSession: { user?: { email?: string } } | null = {
  user: { email: "admin@example.com" },
};
void mock.module("@/auth", () => ({
  auth: async () => mockSession,
}));

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

function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  process.env.EMAIL_DRY_RUN = "true"; // avoid real Resend API calls
  mockSession = { user: { email: "admin@example.com" } };
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.EMAIL_DRY_RUN;
});

describe("POST /api/providers/[id]/test-send", () => {
  test("returns 401 when no session", async () => {
    mockSession = null;
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(401);
  });

  test("returns 404 when provider not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/none/test-send", "POST"),
      { params: Promise.resolve({ id: "none" }) },
    );
    expect(res.status).toBe(404);
  });

  test("returns 400 when config is malformed", async () => {
    globalThis.fetch = mockFetch(async () =>
      d1Success([makeProviderRecord({ config: "not-json" })]),
    );
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Provider config invalid");
  });

  test("returns 400 on invalid JSON body", async () => {
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const req = new Request(
      "http://x/api/providers/prov_1/test-send",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: "prov_1" }) });
    expect(res.status).toBe(400);
  });

  test("returns 400 on invalid input (bad email)", async () => {
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST", {
        to: "not-an-email",
      }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(400);
  });

  test("sends successfully via resend dry-run and defaults recipient to admin", async () => {
    globalThis.fetch = mockFetch(async () =>
      d1Success([makeProviderRecord()]),
    );
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      to: string;
      from: string;
      id: string;
    };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("admin@example.com");
    expect(body.from).toContain("mail.example.com");
    expect(body.id).toBeTruthy();
  });

  test("respects custom `to` override", async () => {
    globalThis.fetch = mockFetch(async () =>
      d1Success([makeProviderRecord()]),
    );
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST", {
        to: "someone@else.com",
      }),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { to: string };
    expect(body.to).toBe("someone@else.com");
  });

  test("returns 502 when provider send throws", async () => {
    // Disable both dry-run toggles so the resend provider actually calls
    // fetch. .env.test sets RESEND_DRY_RUN=true by default.
    delete process.env.EMAIL_DRY_RUN;
    const originalResendDryRun = process.env.RESEND_DRY_RUN;
    delete process.env.RESEND_DRY_RUN;
    let call = 0;
    globalThis.fetch = mockFetch(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.resend.com")) {
        return new Response(
          JSON.stringify({ message: "invalid key" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      call++;
      return d1Success([makeProviderRecord()]);
    });
    const { POST } = await import(
      "@/app/api/providers/[id]/test-send/route"
    );
    const res = await POST(
      jsonRequest("http://x/api/providers/prov_1/test-send", "POST"),
      { params: Promise.resolve({ id: "prov_1" }) },
    );
    expect(res.status).toBe(502);
    expect(call).toBeGreaterThanOrEqual(1);
    if (originalResendDryRun !== undefined) {
      process.env.RESEND_DRY_RUN = originalResendDryRun;
    }
  });
});
