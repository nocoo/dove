/**
 * L2: API E2E test runner with full server lifecycle.
 *
 * Steps:
 *   1. Load .env.test — hard fail if missing
 *   2. Inequality check — test URL !== production URL
 *   3. Spawn `wrangler dev --port 17034` with E2E env
 *   4. Wait for server ready (poll /api/live)
 *   5. Run `bun test e2e/api/`
 *   6. Kill server
 *   7. Exit with test exit code
 *
 * Usage:
 *   bun run scripts/run-e2e.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Subprocess } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const E2E_PORT = 17034;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Step 1: Load .env.test
// ---------------------------------------------------------------------------

function loadEnvFile(path: string): Map<string, string> {
  const content = readFileSync(path, "utf-8");
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars.set(key, value);
  }
  return vars;
}

function loadTestEnv(): Map<string, string> {
  const envPath = resolve(ROOT, ".env.test");
  try {
    return loadEnvFile(envPath);
  } catch {
    console.error("FATAL: .env.test not found.");
    console.error("  L2 E2E requires a test Worker. See docs/02-quality-upgrade.md Step 3.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 2: Inequality check
// ---------------------------------------------------------------------------

function checkInequality(testUrl: string): void {
  try {
    const prodVars = loadEnvFile(resolve(ROOT, ".env.local"));
    const prodUrl = prodVars.get("D1_WORKER_URL");
    if (prodUrl && testUrl === prodUrl) {
      console.error("FATAL: D1_WORKER_URL in .env.test matches .env.local!");
      console.error(`  Both point to: ${testUrl}`);
      process.exit(1);
    }
    if (prodUrl) {
      console.log(`  Inequality check: ${testUrl} !== ${prodUrl}`);
    }
  } catch {
    console.log("  WARN: .env.local not found, skipping inequality check (OK in CI).");
  }
}

// ---------------------------------------------------------------------------
// Step 3: Spawn dev server
// ---------------------------------------------------------------------------

function spawnDevServer(envVars: Map<string, string>): Subprocess {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  for (const [key, value] of envVars) {
    env[key] = value;
  }
  env.PORT = String(E2E_PORT);

  console.log(`\nStep 3: Starting wrangler dev on port ${E2E_PORT}...`);

  const proc = Bun.spawn(
    [
      "npx",
      "wrangler",
      "dev",
      "--env",
      "test",
      "--env-file",
      ".env.test",
      "--port",
      String(E2E_PORT),
    ],
    {
      cwd: ROOT,
      env,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  return proc;
}

// ---------------------------------------------------------------------------
// Step 4: Wait for server ready
// ---------------------------------------------------------------------------

async function waitForServer(): Promise<void> {
  const url = `http://localhost:${E2E_PORT}/api/live`;
  const start = Date.now();

  console.log(`Step 4: Waiting for server at ${url}...`);

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = (await response.json()) as {
          status: string;
          database?: { connected?: boolean };
        };
        if (body.status === "ok" && body.database?.connected === true) {
          console.log(`  Server ready (${Date.now() - start}ms)`);
          return;
        }
        console.log(`  Server responded but not ready: ${JSON.stringify(body)}`);
      }
    } catch {
      // Server not up yet
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  console.error(`FATAL: Server did not start within ${MAX_WAIT_MS}ms`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 4b: Warm up D1 connection
// ---------------------------------------------------------------------------

async function warmupD1(): Promise<void> {
  console.log("Step 4b: Warming up D1 connection...");
  const start = Date.now();
  try {
    const res = await fetch(`http://localhost:${E2E_PORT}/api/projects`, {
      signal: AbortSignal.timeout(15_000),
    });
    await res.text();
    console.log(`  D1 warm (${Date.now() - start}ms, status=${res.status})`);
  } catch (err) {
    console.log(`  WARN: D1 warmup call failed (${Date.now() - start}ms): ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Run tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<number> {
  console.log("\nStep 5: Running E2E tests...\n");

  const proc = Bun.spawn(["bun", "test", "--timeout", "15000", "e2e/api/"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== L2: API E2E Test Runner ===\n");

  // Step 1: Load .env.test
  console.log("Step 1: Loading .env.test...");
  const envVars = loadTestEnv();
  const testUrl = envVars.get("D1_WORKER_URL");
  const testApiKey = envVars.get("D1_WORKER_API_KEY");

  if (!testUrl || !testApiKey) {
    console.error("FATAL: .env.test must define D1_WORKER_URL and D1_WORKER_API_KEY");
    process.exit(1);
  }
  console.log(`  D1_WORKER_URL = ${testUrl}`);

  // Step 2: Inequality check
  console.log("\nStep 2: Checking URL inequality...");
  checkInequality(testUrl);

  // Step 3: Spawn dev server
  const server = spawnDevServer(envVars);

  let testExitCode = 1;

  try {
    // Step 4: Wait for ready
    await waitForServer();

    // Step 4b: Warm up D1
    await warmupD1();

    // Step 5: Run tests
    testExitCode = await runTests();
  } finally {
    // Step 6: Kill server
    console.log("\nStep 6: Stopping dev server...");
    server.kill();
    await server.exited;
    console.log("  Server stopped.");
  }

  // Step 7: Exit
  if (testExitCode !== 0) {
    console.error("\n=== E2E tests FAILED ===\n");
    process.exit(1);
  }

  console.log("\n=== E2E tests PASSED ===\n");
}

void main();
