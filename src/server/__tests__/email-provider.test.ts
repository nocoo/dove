import { describe, test, expect } from "bun:test";
import {
  parseProviderConfig,
  createProvider,
  getProviderDomain,
} from "../lib/email/provider";
import type { EmailProviderRecord } from "../lib/db/email-providers";

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

    test("throws on missing api_key", () => {
      expect(() =>
        parseProviderConfig(makeProvider({ config: JSON.stringify({}) })),
      ).toThrow("missing api_key");
    });
  });

  describe("createProvider", () => {
    test("creates resend provider", async () => {
      const provider = await createProvider({ type: "resend", api_key: "re_test" });
      expect(provider.type).toBe("resend");
      expect(provider.supportsDryRun()).toBe(true);
    });

    test("creates cloudflare provider", async () => {
      const mockBinding = { send: async () => {} } as unknown as SendEmail;
      const mockDb = {} as D1Database;
      const provider = await createProvider({
        type: "cloudflare",
      }, mockBinding, mockDb);
      expect(provider.type).toBe("cloudflare");
    });
  });

  describe("getProviderDomain", () => {
    test("returns provider domain", () => {
      expect(getProviderDomain(makeProvider())).toBe("example.com");
    });

    test("throws when null provider and no env", () => {
      expect(() => getProviderDomain(null)).toThrow("RESEND_FROM_DOMAIN not configured");
    });
  });
});
