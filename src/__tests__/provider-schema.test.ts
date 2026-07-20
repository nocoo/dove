import { describe, expect, test } from "vitest";
import { parseConfigForType } from "@/lib/email/provider-schema";

describe("parseConfigForType(resend)", () => {
	test("accepts valid api_key (and surfaces the parsed value, not just success)", () => {
		const r = parseConfigForType("resend", { api_key: "re_abc" });
		expect(r.success).toBe(true);
		// A regression that returned success=true but stripped the
		// api_key (e.g. wrong .pick() / wrong schema) would silently pass
		// the bare success check, then crash later when the provider tries
		// to read the api_key. Pin the actual parsed payload.
		if (r.success) {
			expect(r.data).toEqual({ api_key: "re_abc" });
		}
	});

	test("rejects missing api_key (with error path)", () => {
		const r = parseConfigForType("resend", {});
		expect(r.success).toBe(false);
		// Pin that the error specifically targets api_key — a regression
		// that rejected on a different field (e.g. validated against
		// CloudflareConfigSchema) would still produce success=false but
		// for the wrong reason. The dashboard's field-level error display
		// would then point at the wrong UI element.
		if (!r.success) {
			const issues = r.error.issues ?? [];
			expect(issues.some((i) => i.path.includes("api_key"))).toBe(true);
		}
	});

	test("rejects empty api_key", () => {
		const r = parseConfigForType("resend", { api_key: "" });
		expect(r.success).toBe(false);
	});
});

describe("parseConfigForType(cloudflare)", () => {
	test("accepts empty config (and parsed payload IS an empty object)", () => {
		const r = parseConfigForType("cloudflare", {});
		expect(r.success).toBe(true);
		if (r.success) {
			// CloudflareConfigSchema is z.object({}) — r.data MUST be {}.
			// A regression returning null or undefined would crash the
			// downstream sanitize / persist pipeline.
			expect(r.data).toEqual({});
		}
	});

	test("accepts config with extra fields (and verifies stripping actually happened)", () => {
		const r = parseConfigForType("cloudflare", { extra: "ignored" });
		expect(r.success).toBe(true);
		// Cloudflare schema is empty-object — a regression to z.passthrough()
		// would let `extra` survive into the persisted config (clutter +
		// potential injection vector if the unknown key happens to match a
		// future schema field). Pin: parsed data MUST be {} after strip.
		if (r.success) {
			expect(r.data).toEqual({});
			expect(r.data).not.toHaveProperty("extra");
		}
	});
});
