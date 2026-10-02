import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import { dbInit } from "../routes/db-init";

function fixture(
	rows = [
		{ key: "env", value: "test" },
		{ key: "run_id", value: "owned-run" },
	],
) {
	const all = vi.fn(async () => ({ results: rows }));
	const prepare = vi.fn(() => ({ all }));
	const env = {
		DB: { prepare },
		DEV_MODE: "true",
		EMAIL_DRY_RUN: "true",
		RESEND_DRY_RUN: "true",
	} as unknown as Env;
	return { all, prepare, env };
}

describe("read-only run ownership endpoint", () => {
	test("reads both marker values without initializing schema", async () => {
		const { env, prepare } = fixture();
		const response = await dbInit.request("http://127.0.0.1/marker", {}, env);
		expect(await response.json()).toEqual({ environment: "test", runId: "owned-run" });
		expect(prepare).toHaveBeenCalledExactlyOnceWith("SELECT key, value FROM _test_marker");
	});
	test.each(["https://production.example.com/marker", "http://localhost.example.com/marker"])(
		"refuses remote host %s before DB access",
		async (url) => {
			const { env, prepare } = fixture();
			const response = await dbInit.request(url, { headers: { host: "localhost" } }, env);
			expect(response.status).toBe(403);
			expect(prepare).not.toHaveBeenCalled();
		},
	);
	test.each(["DEV_MODE", "EMAIL_DRY_RUN", "RESEND_DRY_RUN"] as const)(
		"requires %s before DB access",
		async (key) => {
			const { env, prepare } = fixture();
			env[key] = "false";
			expect((await dbInit.request("http://127.0.0.1/marker", {}, env)).status).toBe(403);
			expect(prepare).not.toHaveBeenCalled();
		},
	);
	test("does not manufacture ownership for an empty database", async () => {
		const { env } = fixture([]);
		expect(await (await dbInit.request("http://127.0.0.1/marker", {}, env)).json()).toEqual({
			environment: null,
			runId: null,
		});
	});
	test("reports missing marker without writing schema", async () => {
		const { env, all, prepare } = fixture();
		all.mockRejectedValueOnce(new Error("no marker table"));
		expect((await dbInit.request("http://127.0.0.1/marker", {}, env)).status).toBe(503);
		expect(prepare).toHaveBeenCalledExactlyOnceWith("SELECT key, value FROM _test_marker");
	});
});
