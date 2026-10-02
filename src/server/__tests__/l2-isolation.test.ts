import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	assertOwnedRun,
	assertTestMarker,
	validateTestEnvironment,
} from "../../../scripts/l2-isolation";

const safe = {
	D1_WORKER_URL: "http://127.0.0.1:0",
	D1_WORKER_API_KEY: "ci-placeholder",
	EMAIL_DRY_RUN: "true",
	RESEND_DRY_RUN: "true",
	DEV_MODE: "true",
	RESEND_API_KEY: "re_ci_placeholder_not_real",
	RESEND_FROM_DOMAIN: "test.example.com",
};

describe("L2 environment isolation", () => {
	test("accepts only explicit safe placeholders and loopback", () => {
		expect(() => validateTestEnvironment(safe, {})).not.toThrow();
	});
	test.each([
		"https://test.example.com",
		"http://localhost.example.com",
		"http://127.0.0.1@production.example.com",
		"https://127.0.0.1",
		"http://user@localhost",
	])("rejects external or credential-bearing target %s", (url) => {
		expect(() => validateTestEnvironment({ ...safe, D1_WORKER_URL: url }, {})).toThrow();
	});
	test.each([
		"CLOUDFLARE_API_TOKEN",
		"CLOUDFLARE_API_KEY",
		"CLOUDFLARE_ACCOUNT_ID",
		"CF_API_TOKEN",
		"CF_ACCOUNT_ID",
	])("rejects inherited %s before fixtures", (key) => {
		expect(() => validateTestEnvironment(safe, { [key]: "fixture-credential" })).toThrow(
			"Production-capable",
		);
	});
	test.each([
		"EMAIL_DRY_RUN",
		"RESEND_DRY_RUN",
		"DEV_MODE",
		"D1_WORKER_API_KEY",
		"RESEND_API_KEY",
		"RESEND_FROM_DOMAIN",
	])("rejects unsafe %s", (key) => {
		expect(() => validateTestEnvironment({ ...safe, [key]: "unsafe-fixture" }, {})).toThrow();
	});
	test("rejects inherited provider credentials even with a safe file", () => {
		expect(() => validateTestEnvironment(safe, { RESEND_API_KEY: "fixture-provider-key" })).toThrow(
			"placeholder",
		);
	});
});

test("refuses stale, missing and foreign database markers", () => {
	for (const value of [
		null,
		{ marker: "e2e-test-db" },
		{ environment: "production", runId: "own" },
		{ environment: "test", runId: "another" },
	]) {
		expect(() => assertTestMarker(value, "own")).toThrow("does not belong");
	}
	expect(() => assertTestMarker({ environment: "test", runId: "own" }, "own")).not.toThrow();
});

test("cleanup ownership rejects wrong IDs and redirected directories", () => {
	const parent = realpathSync(tmpdir());
	const root = mkdtempSync(join(parent, "dove-l2-"));
	const link = `${root}-link`;
	try {
		writeFileSync(join(root, "owner"), "owned");
		expect(() => assertOwnedRun(root, parent, "owned")).not.toThrow();
		expect(() => assertOwnedRun(root, parent, "foreign")).toThrow("ownership");
		symlinkSync(root, link);
		expect(() => assertOwnedRun(link, parent, "owned")).toThrow("redirected");
	} finally {
		rmSync(link, { force: true });
		rmSync(root, { recursive: true });
	}
});
