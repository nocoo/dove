import { describe, test, expect, vi } from "vitest";
import {
  parseProviderConfig,
  createProvider,
  createLegacyProvider,
  getProviderDomain,
} from "../lib/email/provider";
import type { EmailProviderRecord } from "../lib/db/email-providers";
import type { Env } from "../env";

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

describe("server provider", () => {
  describe("parseProviderConfig", () => {
    test("parses resend config", () => {
      const config = parseProviderConfig(makeProvider());
      expect(config.type).toBe("resend");
      if (config.type === "resend") {
        expect(config.api_key).toBe("re_test123");
      }
    });

    test("parses cloudflare config", () => {
      const config = parseProviderConfig(
        makeProvider({
          type: "cloudflare",
          config: JSON.stringify({}),
        }),
      );
      expect(config.type).toBe("cloudflare");
    });

    test("throws on invalid JSON", () => {
      expect(() =>
        parseProviderConfig(makeProvider({ config: "not-json" })),
      ).toThrow("Invalid provider config JSON");
    });

    test("throws on null config object", () => {
      expect(() =>
        parseProviderConfig(makeProvider({ config: "null" })),
      ).toThrow("Invalid provider config");
    });

    test("throws on missing api_key", () => {
      expect(() =>
        parseProviderConfig(makeProvider({ config: JSON.stringify({}) })),
      ).toThrow("missing api_key");
    });

    test("throws on unknown provider type", () => {
      expect(() =>
        parseProviderConfig(makeProvider({ type: "unknown" as "resend", config: "{}" })),
      ).toThrow("Unknown provider type");
    });
  });

  describe("createProvider", () => {
    test("creates resend provider", async () => {
      const provider = await createProvider({ type: "resend", api_key: "re_test" });
      expect(provider.type).toBe("resend");
      expect(provider.supportsDryRun()).toBe(true);
    });

    test("creates cloudflare provider", async () => {
      const mockBinding = { send: vi.fn() } as unknown as SendEmail;
      const mockDb = {} as D1Database;
      const provider = await createProvider({
        type: "cloudflare",
      }, mockBinding, mockDb);
      expect(provider.type).toBe("cloudflare");
    });

    test("throws when cloudflare provider missing email binding", async () => {
      await expect(createProvider({ type: "cloudflare" })).rejects.toThrow(
        "EMAIL binding required",
      );
    });

    test("throws on unknown provider type", async () => {
      await expect(
        createProvider({ type: "unknown" as "resend", api_key: "" }),
      ).rejects.toThrow("Unknown provider type");
    });
  });

  describe("createLegacyProvider", () => {
    test("creates provider from env RESEND_API_KEY", async () => {
      const env = { RESEND_API_KEY: "re_legacy_key" } as Env;
      const provider = await createLegacyProvider(env);
      expect(provider.type).toBe("resend");
    });

    test("enables dry run when EMAIL_DRY_RUN=true", async () => {
      const env = { RESEND_API_KEY: "re_key", EMAIL_DRY_RUN: "true" } as Env;
      const provider = await createLegacyProvider(env);
      expect(provider.supportsDryRun()).toBe(true);
    });

    test("enables dry run when RESEND_DRY_RUN=true", async () => {
      const env = { RESEND_API_KEY: "re_key", RESEND_DRY_RUN: "true" } as Env;
      const provider = await createLegacyProvider(env);
      expect(provider.supportsDryRun()).toBe(true);
    });

    test("throws when RESEND_API_KEY not set", async () => {
      const env = {} as Env;
      await expect(createLegacyProvider(env)).rejects.toThrow("RESEND_API_KEY not configured");
    });
  });

  describe("getProviderDomain", () => {
    test("returns provider domain", () => {
      expect(getProviderDomain(makeProvider())).toBe("example.com");
    });

    test("returns env domain when provider is null", () => {
      const env = { RESEND_FROM_DOMAIN: "fallback.com" } as Env;
      expect(getProviderDomain(null, env)).toBe("fallback.com");
    });

    test("throws when null provider and no env", () => {
      expect(() => getProviderDomain(null)).toThrow("RESEND_FROM_DOMAIN not configured");
    });

    test("throws when null provider and env domain not set", () => {
      const env = {} as Env;
      expect(() => getProviderDomain(null, env)).toThrow("RESEND_FROM_DOMAIN not configured");
    });
  });
});
