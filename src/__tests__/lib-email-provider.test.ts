import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmailProviderRecord } from "@/lib/types/email-provider";

function makeProvider(overrides: Partial<EmailProviderRecord> = {}): EmailProviderRecord {
  return {
    id: "prov_001",
    name: "Test Resend",
    type: "resend",
    domain: "example.com",
    config: JSON.stringify({ api_key: "re_test123" }),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("lib/email/provider", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe("parseProviderConfig", () => {
    test("parses resend config", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      const config = parseProviderConfig(makeProvider());
      expect(config.type).toBe("resend");
      if (config.type === "resend") {
        expect(config.api_key).toBe("re_test123");
      }
    });

    test("parses cloudflare config", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      const config = parseProviderConfig(
        makeProvider({ type: "cloudflare", config: JSON.stringify({}) }),
      );
      expect(config.type).toBe("cloudflare");
    });

    test("throws on invalid JSON", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ config: "not-json" })),
      ).toThrow("Invalid provider config JSON");
    });

    test("throws on null config object", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ config: "null" })),
      ).toThrow("Invalid provider config");
    });

    test("throws on non-object config", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ config: '"string"' })),
      ).toThrow("Invalid provider config");
    });

    test("throws on missing api_key for resend", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ config: JSON.stringify({}) })),
      ).toThrow("missing api_key");
    });

    test("throws on empty api_key for resend", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ config: JSON.stringify({ api_key: "" }) })),
      ).toThrow("missing api_key");
    });

    test("throws on unknown provider type", async () => {
      const { parseProviderConfig } = await import("@/lib/email/provider");
      expect(() =>
        parseProviderConfig(makeProvider({ type: "unknown" as "resend", config: "{}" })),
      ).toThrow("Unknown provider type");
    });
  });

  describe("createProvider", () => {
    test("creates resend provider", async () => {
      const { createProvider } = await import("@/lib/email/provider");
      const provider = await createProvider({ type: "resend", api_key: "re_test" });
      expect(provider.type).toBe("resend");
      expect(provider.supportsDryRun()).toBe(true);
    });

    test("creates cloudflare provider", async () => {
      const { createProvider } = await import("@/lib/email/provider");
      const mockBinding = { send: vi.fn() } as unknown as SendEmail;
      const mockDb = {} as D1Database;
      const provider = await createProvider({ type: "cloudflare" }, mockBinding, mockDb);
      expect(provider.type).toBe("cloudflare");
      expect(provider.supportsDryRun()).toBe(false);
    });

    test("throws when cloudflare provider missing email binding", async () => {
      const { createProvider } = await import("@/lib/email/provider");
      await expect(createProvider({ type: "cloudflare" })).rejects.toThrow(
        "EMAIL binding required",
      );
    });

    test("throws on unknown provider type", async () => {
      const { createProvider } = await import("@/lib/email/provider");
      await expect(
        createProvider({ type: "unknown" as "resend", api_key: "" }),
      ).rejects.toThrow("Unknown provider type");
    });
  });

  describe("createLegacyProvider", () => {
    test("creates provider from RESEND_API_KEY env", async () => {
      process.env.RESEND_API_KEY = "re_legacy_key";
      const { createLegacyProvider } = await import("@/lib/email/provider");
      const provider = await createLegacyProvider();
      expect(provider.type).toBe("resend");
    });

    test("throws when RESEND_API_KEY not set", async () => {
      delete process.env.RESEND_API_KEY;
      const { createLegacyProvider } = await import("@/lib/email/provider");
      await expect(createLegacyProvider()).rejects.toThrow("RESEND_API_KEY not configured");
    });
  });

  describe("getProviderDomain", () => {
    test("returns provider domain when provider exists", async () => {
      const { getProviderDomain } = await import("@/lib/email/provider");
      expect(getProviderDomain(makeProvider())).toBe("example.com");
    });

    test("returns env domain when provider is null", async () => {
      process.env.RESEND_FROM_DOMAIN = "fallback.com";
      const { getProviderDomain } = await import("@/lib/email/provider");
      expect(getProviderDomain(null)).toBe("fallback.com");
    });

    test("throws when provider null and env not set", async () => {
      delete process.env.RESEND_FROM_DOMAIN;
      const { getProviderDomain } = await import("@/lib/email/provider");
      expect(() => getProviderDomain(null)).toThrow("RESEND_FROM_DOMAIN not configured");
    });
  });

  describe("isDryRunEnabled", () => {
    test("returns true when EMAIL_DRY_RUN=true", async () => {
      process.env.EMAIL_DRY_RUN = "true";
      const { isDryRunEnabled } = await import("@/lib/email/provider");
      expect(isDryRunEnabled()).toBe(true);
      expect(isDryRunEnabled("resend")).toBe(true);
      expect(isDryRunEnabled("cloudflare")).toBe(true);
    });

    test("returns true for resend when RESEND_DRY_RUN=true", async () => {
      process.env.RESEND_DRY_RUN = "true";
      const { isDryRunEnabled } = await import("@/lib/email/provider");
      expect(isDryRunEnabled()).toBe(true);
      expect(isDryRunEnabled("resend")).toBe(true);
      expect(isDryRunEnabled("legacy")).toBe(true);
    });

    test("returns false for cloudflare when only RESEND_DRY_RUN=true", async () => {
      process.env.RESEND_DRY_RUN = "true";
      const { isDryRunEnabled } = await import("@/lib/email/provider");
      expect(isDryRunEnabled("cloudflare")).toBe(false);
    });

    test("returns false when no dry run env vars set", async () => {
      delete process.env.EMAIL_DRY_RUN;
      delete process.env.RESEND_DRY_RUN;
      const { isDryRunEnabled } = await import("@/lib/email/provider");
      expect(isDryRunEnabled()).toBe(false);
    });
  });
});
