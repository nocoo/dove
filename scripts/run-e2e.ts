import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertOwnedRun, assertTestMarker, validateTestEnvironment } from "./l2-isolation";

const ROOT = resolve(import.meta.dirname, "..");

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((accept, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", accept);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No local port was allocated");
	await new Promise<void>((accept, reject) =>
		server.close((error) => (error ? reject(error) : accept())),
	);
	return address.port;
}

async function stop(server: ChildProcess): Promise<void> {
	const pid = server.pid;
	if (!pid) return;
	const exited =
		server.exitCode !== null || server.signalCode !== null
			? Promise.resolve()
			: new Promise<void>((accept) => server.once("exit", () => accept()));
	const kill = (signal: NodeJS.Signals) => {
		try {
			process.kill(-pid, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	};
	kill("SIGTERM");
	const timer = setTimeout(() => kill("SIGKILL"), 5_000);
	try {
		await exited;
	} finally {
		clearTimeout(timer);
	}
}

async function runCommand(
	argv: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	signal: AbortSignal,
	timeout: number,
): Promise<void> {
	const [binary, ...args] = argv;
	if (!binary) throw new Error("Missing local command");
	signal.throwIfAborted();
	const child = spawn(binary, args, { cwd, env, stdio: "inherit", detached: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: (() => void) | undefined;
	try {
		await new Promise<void>((accept, reject) => {
			child.once("error", reject);
			child.once("exit", (code) =>
				code === 0 ? accept() : reject(new Error(`Local command failed: ${code}`)),
			);
			timer = setTimeout(() => reject(new Error("Local command timed out")), timeout);
			abort = () => reject(new Error("L2 execution interrupted"));
			signal.addEventListener("abort", abort, { once: true });
		});
	} finally {
		clearTimeout(timer);
		if (abort) signal.removeEventListener("abort", abort);
		await stop(child);
	}
}

async function main(): Promise<void> {
	const values = Object.fromEntries(
		readFileSync(join(ROOT, ".env.test"), "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1)];
			}),
	);
	validateTestEnvironment(values, process.env);
	const original = Bun.TOML.parse(readFileSync(join(ROOT, "wrangler.toml"), "utf8")) as {
		main: string;
		compatibility_date: string;
		env?: { test?: { d1_databases?: { binding: string; remote?: boolean }[] } };
	};
	const bindings = original.env?.test?.d1_databases;
	if (bindings?.length !== 1 || bindings[0]?.binding !== "DB" || bindings[0].remote !== false)
		throw new Error("The test environment must explicitly declare one local DB binding");
	const entry = realpathSync(resolve(ROOT, original.main));
	const assets = realpathSync(resolve(ROOT, "dist/client"));
	if (!entry.startsWith(`${ROOT}/`) || !assets.startsWith(`${ROOT}/`))
		throw new Error("Test inputs must remain inside the owned checkout");
	const parent = realpathSync(tmpdir());
	const directory = mkdtempSync(join(parent, "dove-l2-"));
	const runId = randomUUID();
	writeFileSync(join(directory, "owner"), runId, { mode: 0o600, flag: "wx" });
	assertOwnedRun(directory, parent, runId);
	const port = await availablePort();
	const origin = `http://127.0.0.1:${port}`;
	const config = join(directory, "wrangler.json");
	const persist = join(directory, "persist");
	const database = `dove-l2-${runId}`;
	const testValues = {
		D1_WORKER_URL: origin,
		D1_WORKER_API_KEY: "ci-placeholder",
		EMAIL_DRY_RUN: "true",
		RESEND_DRY_RUN: "true",
		DEV_MODE: "true",
		RESEND_API_KEY: "re_ci_placeholder_not_real",
		RESEND_FROM_DOMAIN: "test.example.com",
		DEV_USER: "test@example.test",
		ENVIRONMENT: "test",
	};
	writeFileSync(
		config,
		JSON.stringify({
			name: "dove-l2",
			main: entry,
			compatibility_date: original.compatibility_date,
			assets: {
				directory: assets,
				binding: "ASSETS",
				run_worker_first: ["/api/*"],
				not_found_handling: "single-page-application",
			},
			d1_databases: [{ binding: "DB", database_name: database, database_id: runId, remote: false }],
			vars: testValues,
		}),
		{ mode: 0o600, flag: "wx" },
	);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SystemRoot"].includes(key),
		),
	);
	Object.assign(env, testValues, {
		PORT: String(port),
		DOVE_TEST_RUN_ID: runId,
		XDG_CONFIG_HOME: join(directory, "config"),
		WRANGLER_SEND_METRICS: "false",
		CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
	});
	const wrangler = ["node", join(ROOT, "node_modules/wrangler/bin/wrangler.js")];
	let server: ChildProcess | undefined;
	let markerVerified = false;
	const controller = new AbortController();
	const interrupt = () => controller.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	try {
		assertOwnedRun(directory, parent, runId);
		await runCommand(
			[
				...wrangler,
				"d1",
				"execute",
				database,
				"--local",
				"--config",
				config,
				"--persist-to",
				persist,
				"--command",
				`CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env','test'),('run_id','${runId}');`,
			],
			directory,
			env,
			controller.signal,
			60_000,
		);
		server = spawn(
			"node",
			[
				...wrangler.slice(1),
				"dev",
				"--local",
				"--config",
				config,
				"--persist-to",
				persist,
				"--ip",
				"127.0.0.1",
				"--port",
				String(port),
				"--inspector-port",
				"0",
			],
			{ cwd: directory, env, stdio: "inherit", detached: true },
		);
		let startError: Error | undefined;
		server.on("error", (error) => {
			startError = error;
		});
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			controller.signal.throwIfAborted();
			if (startError || server.exitCode !== null || server.signalCode !== null)
				throw startError ?? new Error("Owned Wrangler exited before readiness");
			let response: Response;
			try {
				response = await fetch(`${origin}/api/db/init/marker`, {
					signal: AbortSignal.timeout(2_000),
				});
			} catch {
				await Bun.sleep(300);
				continue;
			}
			if (!response.ok) throw new Error(`Marker endpoint rejected the run: ${response.status}`);
			assertTestMarker(await response.json(), runId);
			markerVerified = true;
			break;
		}
		if (!markerVerified) throw new Error("Timed out waiting for the owned database marker");
		console.info(`Owned L2 ready at ${origin}; isolated state: ${persist}`);
		const initialized = await fetch(`${origin}/api/db/init`, {
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		});
		if (!initialized.ok || ((await initialized.json()) as { ok?: boolean }).ok !== true)
			throw new Error("Schema initialization failed");
		await runCommand(
			["bun", "test", "--timeout", "15000", "e2e/api/"],
			ROOT,
			env,
			controller.signal,
			180_000,
		);
		assertTestMarker(
			await (
				await fetch(`${origin}/api/db/init/marker`, { signal: AbortSignal.timeout(2_000) })
			).json(),
			runId,
		);
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
		let cleanupVerified = false;
		if (markerVerified && server?.exitCode === null && server.signalCode === null) {
			try {
				const response = await fetch(`${origin}/api/db/init/marker`, {
					signal: AbortSignal.timeout(2_000),
				});
				assertTestMarker(await response.json(), runId);
				cleanupVerified = true;
			} catch {
				console.error("Marker verification failed before cleanup; preserving state");
			}
		}
		if (server) await stop(server);
		assertOwnedRun(directory, parent, runId);
		if (cleanupVerified) rmSync(directory, { recursive: true });
		else console.error(`Unverified test state preserved for inspection: ${directory}`);
	}
}

await main();
