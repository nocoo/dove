import { describe, expect, test } from "vitest";
import { hashEmail } from "@/lib/email-hash";

const ARCHITIE_HASH = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";

describe("hashEmail", () => {
	test("hashes the canonical author email to the published SHA-256", async () => {
		await expect(hashEmail("architie@gmail.com")).resolves.toBe(ARCHITIE_HASH);
	});

	test("trims and lowercases before hashing", async () => {
		await expect(hashEmail("  ARCHITIE@GMAIL.COM  ")).resolves.toBe(ARCHITIE_HASH);
	});

	test("returns 64 lowercase hex characters", async () => {
		const hash = await hashEmail("dev@localhost");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("different emails produce different hashes", async () => {
		const a = await hashEmail("a@example.com");
		const b = await hashEmail("b@example.com");
		expect(a).not.toBe(b);
	});
});
