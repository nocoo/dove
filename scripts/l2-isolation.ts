import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function validateTestEnvironment(
	values: Record<string, string>,
	inherited: Record<string, string | undefined>,
): void {
	for (const [key, value] of Object.entries(inherited)) {
		if (
			value &&
			/^(CLOUDFLARE_(API_TOKEN|API_KEY|EMAIL|ACCOUNT_ID)|CF_(API_TOKEN|API_KEY|EMAIL|ACCOUNT_ID))$/.test(
				key,
			)
		)
			throw new Error(`Production-capable environment is forbidden: ${key}`);
	}
	const url = new URL(values.D1_WORKER_URL ?? "");
	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password
	)
		throw new Error("The test configuration must declare an HTTP loopback URL");
	for (const key of ["EMAIL_DRY_RUN", "RESEND_DRY_RUN", "DEV_MODE"]) {
		if (values[key] !== "true") throw new Error(`${key} must be true`);
	}
	for (const [key, expected] of Object.entries({
		D1_WORKER_API_KEY: "ci-placeholder",
		RESEND_API_KEY: "re_ci_placeholder_not_real",
		RESEND_FROM_DOMAIN: "test.example.com",
	})) {
		if (values[key] !== expected || (inherited[key] && inherited[key] !== expected))
			throw new Error(`Only the documented test placeholder is allowed: ${key}`);
	}
}

export function assertOwnedRun(root: string, parent: string, runId: string): void {
	if (
		realpathSync(root) !== root ||
		dirname(root) !== realpathSync(parent) ||
		!basename(root).startsWith("dove-l2-")
	)
		throw new Error("Refusing a redirected or unowned L2 directory");
	if (
		!lstatSync(join(root, "owner")).isFile() ||
		readFileSync(join(root, "owner"), "utf8") !== runId
	)
		throw new Error("L2 directory ownership does not match");
}

export function assertTestMarker(value: unknown, runId: string): void {
	if (
		!value ||
		typeof value !== "object" ||
		!("environment" in value) ||
		!("runId" in value) ||
		value.environment !== "test" ||
		value.runId !== runId
	)
		throw new Error("The responding database does not belong to this test run");
}
