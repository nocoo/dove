import { describe, expect, test } from "vitest";
import { APP_VERSION } from "@/lib/version";

describe("version", () => {
	test("APP_VERSION uses the test-env fallback when __APP_VERSION__ define is absent", () => {
		// Tests run without vite's `define`, so the fallback path must be taken.
		expect(APP_VERSION).toBe("0.0.0");
	});

	test("APP_VERSION is a valid semver string", () => {
		// Subsumes earlier "non-empty string" smoke check.
		expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
