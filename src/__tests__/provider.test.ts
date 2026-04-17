import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch } from "./helpers";
import {
  parseProviderConfig,
  createProvider,
  createLegacyProvider,
  getProviderDomain,
  isDryRunEnabled,
} from "@/lib/email/provider";
import type { EmailProviderRecord } from "@/lib/db/email-providers";

let originalFetch: typeof globalThis.fetch;

function makeRecord(
  overrides: Partial<EmailProviderRecord> = {},
): EmailProviderRecord {
  return {
    id: "prov_x",
    name: "X",
    type: "resend",
    domain: "mail.example.com",
    config: JSON.stringify({ api_key: "re_abc" }),
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.RESEND_DRY_RUN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.RESEND_DRY_RUN;
});

describe("parseProviderConfig", () => {
  test("parses a resend config", () => {
    const c = parseProviderConfig(makeRecord());
    expect(c).toEqual({ type: "resend", api_key: "re_abc" });
  });

  test("parses a cloudflare config", () => {
    const c = parseProviderConfig(
      makeRecord({
        type: "cloudflare",
        config: JSON.stringify({
          worker_url: "https://w.example.com",
          api_key: "cf_key",
        }),
      }),
    );
    expect(c).toEqual({
      type: "cloudflare",
      worker_url: "https://w.example.com",
      api_key: "cf_key",
    });
  });

  test("throws on malformed JSON", () => {
    expect(() =>
      parseProviderConfig(makeRecord({ config: "{not json" })),
    ).toThrow(/Invalid provider config JSON/);
  });

  test("throws when resend missing api_key", () => {
    expect(() =>
      parseProviderConfig(makeRecord({ config: "{}" })),
    ).toThrow(/missing api_key/);
  });

  test("throws when cloudflare missing worker_url", () => {
    expect(() =>
      parseProviderConfig(
        makeRecord({
          type: "cloudflare",
          config: JSON.stringify({ api_key: "x" }),
        }),
      ),
    ).toThrow(/missing worker_url/);
  });

  test("throws when cloudflare missing api_key", () => {
    expect(() =>
      parseProviderConfig(
        makeRecord({
          type: "cloudflare",
          config: JSON.stringify({ worker_url: "https://w" }),
        }),
      ),
    ).toThrow(/missing api_key/);
  });

  test("throws when config is null JSON", () => {
    expect(() =>
      parseProviderConfig(makeRecord({ config: "null" })),
    ).toThrow(/Invalid provider config for/);
  });
});

describe("createProvider", () => {
  test("returns a Resend instance for type=resend", async () => {
    const p = await createProvider({ type: "resend", api_key: "re_a" });
    expect(p.type).toBe("resend");
    expect(p.supportsDryRun()).toBe(true);
  });

  test("returns a Cloudflare instance for type=cloudflare", async () => {
    const p = await createProvider({
      type: "cloudflare",
      worker_url: "https://w",
      api_key: "k",
    });
    expect(p.type).toBe("cloudflare");
    expect(p.supportsDryRun()).toBe(true);
  });
});

describe("createLegacyProvider", () => {
  test("uses RESEND_API_KEY env var", async () => {
    process.env.RESEND_API_KEY = "re_legacy";
    const p = await createLegacyProvider();
    expect(p.type).toBe("resend");
    delete process.env.RESEND_API_KEY;
  });

  test("throws when RESEND_API_KEY missing", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(createLegacyProvider()).rejects.toThrow(/RESEND_API_KEY/);
  });
});

describe("getProviderDomain", () => {
  test("returns provider.domain when provider record present", () => {
    expect(getProviderDomain(makeRecord({ domain: "x.example.com" }))).toBe(
      "x.example.com",
    );
  });

  test("falls back to RESEND_FROM_DOMAIN when null", () => {
    process.env.RESEND_FROM_DOMAIN = "fallback.example.com";
    expect(getProviderDomain(null)).toBe("fallback.example.com");
    delete process.env.RESEND_FROM_DOMAIN;
  });

  test("throws when null + env var missing", () => {
    delete process.env.RESEND_FROM_DOMAIN;
    expect(() => getProviderDomain(null)).toThrow(/RESEND_FROM_DOMAIN/);
  });
});

describe("isDryRunEnabled", () => {
  test("true when EMAIL_DRY_RUN=true (any provider)", () => {
    process.env.EMAIL_DRY_RUN = "true";
    expect(isDryRunEnabled()).toBe(true);
    expect(isDryRunEnabled("resend")).toBe(true);
    expect(isDryRunEnabled("cloudflare")).toBe(true);
    expect(isDryRunEnabled("legacy")).toBe(true);
  });

  test("RESEND_DRY_RUN legacy alias applies to resend/legacy only", () => {
    process.env.RESEND_DRY_RUN = "true";
    expect(isDryRunEnabled("resend")).toBe(true);
    expect(isDryRunEnabled("legacy")).toBe(true);
    // Critical: must not silently dry-run Cloudflare.
    expect(isDryRunEnabled("cloudflare")).toBe(false);
  });

  test("RESEND_DRY_RUN with no provider type falls back to legacy behaviour", () => {
    process.env.RESEND_DRY_RUN = "true";
    expect(isDryRunEnabled()).toBe(true);
  });

  test("false by default", () => {
    expect(isDryRunEnabled()).toBe(false);
    expect(isDryRunEnabled("cloudflare")).toBe(false);
  });
});

describe("ResendProvider.send", () => {
  const params = {
    from: "App <noreply@test.com>",
    to: "u@example.com",
    subject: "s",
    html: "<p>h</p>",
    idempotencyKey: "slog_1",
  };

  test("calls Resend API with correct headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: "re_ok" }), { status: 200 });
    });

    const { ResendProvider } = await import("@/lib/email/providers/resend");
    const p = new ResendProvider("re_abc");
    const r = await p.send(params);

    expect(r.id).toBe("re_ok");
    expect(capturedHeaders["Authorization"]).toBe("Bearer re_abc");
    expect(capturedHeaders["Idempotency-Key"]).toBe("slog_1");
  });

  test("dry-run returns synthetic id without fetch", async () => {
    let called = false;
    globalThis.fetch = mockFetch(async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });

    const { ResendProvider } = await import("@/lib/email/providers/resend");
    const p = new ResendProvider("re_abc");
    p.setDryRun(true);
    const r = await p.send(params);
    expect(r.id).toMatch(/^dry_run_/);
    expect(called).toBe(false);
  });
});

describe("CloudflareProvider.send", () => {
  const params = {
    from: "App <noreply@test.com>",
    to: "u@example.com",
    subject: "s",
    html: "<p>h</p>",
    idempotencyKey: "slog_1",
  };

  test("POSTs to workerUrl/send with idempotency header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    globalThis.fetch = mockFetch(async (input, init) => {
      capturedUrl = input as string;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: "cf_msg" }), { status: 200 });
    });

    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://worker.example.com", "k");
    const r = await p.send(params);

    expect(capturedUrl).toBe("https://worker.example.com/send");
    expect(capturedHeaders["X-API-Key"]).toBe("k");
    expect(capturedHeaders["X-Idempotency-Key"]).toBe("slog_1");
    const body = JSON.parse(capturedBody) as {
      from_name: string;
      from_address: string;
      to: string;
    };
    expect(body.from_name).toBe("App");
    expect(body.from_address).toBe("noreply@test.com");
    expect(body.to).toBe("u@example.com");
    expect(r.id).toBe("cf_msg");
  });

  test("adds X-Dry-Run header when dry-run enabled", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: "cf_dry" }), { status: 200 });
    });

    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    p.setDryRun(true);
    await p.send(params);
    expect(capturedHeaders["X-Dry-Run"]).toBe("true");
  });

  test("409 with status=sent returns the cached id", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(
        JSON.stringify({ status: "sent", id: "cf_cached" }),
        { status: 409 },
      ),
    );
    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    const r = await p.send(params);
    expect(r.id).toBe("cf_cached");
  });

  test("409 with status=in_progress retries and eventually succeeds", async () => {
    let n = 0;
    globalThis.fetch = mockFetch(async () => {
      n++;
      if (n === 1) {
        return new Response(JSON.stringify({ status: "in_progress" }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ id: "cf_after" }), { status: 200 });
    });

    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    const r = await p.send(params);
    expect(r.id).toBe("cf_after");
    expect(n).toBe(2);
  }, 10000);

  test("throws on 4xx without retry", async () => {
    let n = 0;
    globalThis.fetch = mockFetch(async () => {
      n++;
      return new Response(JSON.stringify({ error: "bad body" }), {
        status: 400,
      });
    });
    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    await expect(p.send(params)).rejects.toThrow(/CF Worker error: 400/);
    expect(n).toBe(1);
  });

  test("retries on 5xx and eventually succeeds", async () => {
    let n = 0;
    globalThis.fetch = mockFetch(async () => {
      n++;
      if (n <= 2) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: "cf_recov" }), { status: 200 });
    });
    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    const r = await p.send(params);
    expect(r.id).toBe("cf_recov");
    expect(n).toBe(3);
  }, 10000);

  test("200 without id throws", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { CloudflareProvider } = await import(
      "@/lib/email/providers/cloudflare"
    );
    const p = new CloudflareProvider("https://w", "k");
    await expect(p.send(params)).rejects.toThrow(/200 without id/);
  });
});

describe("extractName / extractAddress", () => {
  test("parses display name and address", async () => {
    const { extractName, extractAddress } = await import(
      "@/lib/email/providers/cloudflare"
    );
    expect(extractName("App <n@x.com>")).toBe("App");
    expect(extractAddress("App <n@x.com>")).toBe("n@x.com");
  });

  test("handles bare addresses", async () => {
    const { extractName, extractAddress } = await import(
      "@/lib/email/providers/cloudflare"
    );
    expect(extractName("n@x.com")).toBe("");
    expect(extractAddress("n@x.com")).toBe("n@x.com");
  });
});
