import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import type { EmailProviderRecord } from "../lib/db/email-providers";
import {
	createLegacyProvider,
	createProvider,
	getProviderDomain,
	parseProviderConfig,
} from "../lib/email/provider";

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
			expect(() => parseProviderConfig(makeProvider({ config: "not-json" }))).toThrow(
				"Invalid provider config JSON",
			);
		});

		test("throws on null config object", () => {
			expect(() => parseProviderConfig(makeProvider({ config: "null" }))).toThrow(
				"Invalid provider config",
			);
		});

		test("throws on missing api_key", () => {
			expect(() => parseProviderConfig(makeProvider({ config: JSON.stringify({}) }))).toThrow(
				"missing api_key",
			);
		});

		test("SECURITY: thrown error never echoes the api_key value (response-body leak defense)", () => {
			// The webhook /send 'provider_config_invalid' response surfaces
			// this error.message verbatim to bearer-token holders. If a
			// regression interpolated the config OBJECT (or the api_key
			// value) into the thrown message — e.g. for 'helpful' debugging
			// — every webhook caller could read the project's Resend API
			// key from the 500 response body. Pin the contract: even when
			// the schema rejects an api_key (e.g. wrong format / too short),
			// the secret value MUST NOT appear in the error message.
			const SECRET = "re_supersecret_should_never_appear_anywhere_xyz";
			// Empty api_key still triggers the 'missing api_key' / Zod rejection.
			// Pre-include the secret in the config to detect verbatim echoes.
			try {
				parseProviderConfig(
					makeProvider({ config: JSON.stringify({ api_key: "", _other: SECRET }) }),
				);
				// Should have thrown.
				expect.fail("parseProviderConfig must throw on empty api_key");
			} catch (e) {
				const msg = (e as Error).message;
				expect(msg).not.toContain(SECRET);
			}
			// Non-empty but with a secret-looking value — if Zod accepts it,
			// we have no rejection path. Use an invalid TYPE to force throw.
			try {
				parseProviderConfig(
					makeProvider({
						config: JSON.stringify({ api_key: SECRET, extra_invalid: { nested: true } }),
					}),
				);
			} catch (e) {
				const msg = (e as Error).message;
				expect(msg).not.toContain(SECRET);
			}
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
			const provider = await createProvider(
				{
					type: "cloudflare",
				},
				mockBinding,
				mockDb,
			);
			expect(provider.type).toBe("cloudflare");
		});

		test("throws when cloudflare provider missing email binding", async () => {
			await expect(createProvider({ type: "cloudflare" })).rejects.toThrow(
				"EMAIL binding required",
			);
		});

		test("throws on unknown provider type", async () => {
			await expect(createProvider({ type: "unknown" as "resend", api_key: "" })).rejects.toThrow(
				"Unknown provider type",
			);
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
