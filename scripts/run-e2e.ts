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
// Step 2: Inequality + naming check
// ---------------------------------------------------------------------------

function checkInequality(testUrl: string): void {
  // Hard requirement: the test Worker URL must contain the literal "test"
  // somewhere in the host. This prevents a misconfigured .env.test from
  // pointing at the production worker even if .env.local is absent.
  const testHost = new URL(testUrl).host;
  if (!/test/i.test(testHost)) {
    console.error(`FATAL: D1_WORKER_URL host (${testHost}) must contain "test".`);
    console.error("  E2E refuses to run against a Worker that doesn't self-identify as a test instance.");
    process.exit(1);
  }

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
// Step 4b: Initialize D1 schema (idempotent)
// ---------------------------------------------------------------------------

async function initSchema(): Promise<void> {
  console.log("Step 4b: Initializing D1 schema...");
  const start = Date.now();
  try {
    const res = await fetch(`http://localhost:${E2E_PORT}/api/db/init`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json() as { ok?: boolean; statements?: number };
    if (res.ok && body.ok) {
      console.log(`  Schema initialized (${Date.now() - start}ms, ${body.statements} statements)`);
    } else {
      console.error(`  WARN: Schema init returned ${res.status}: ${JSON.stringify(body)}`);
    }
  } catch (err) {
    console.error(`  FATAL: Schema init failed (${Date.now() - start}ms): ${err}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 4c: Warm up D1 connection
// ---------------------------------------------------------------------------

async function warmupD1(): Promise<void> {
  console.log("Step 4c: Warming up D1 connection...");
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
// Step 4d: Verify the bound D1 is the test database (_test_marker row).
// ---------------------------------------------------------------------------

async function verifyTestMarker(): Promise<void> {
  console.log("Step 4d: Verifying _test_marker (refuse to run against prod D1)...");
  try {
    const res = await fetch(`http://localhost:${E2E_PORT}/api/db/init/marker`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { marker?: string | null };
    if (body.marker !== "e2e-test-db") {
      console.error(`FATAL: _test_marker missing or wrong (got ${JSON.stringify(body.marker)}).`);
      console.error("  This D1 was NOT initialized as a test database.");
      console.error("  If this is unexpected, your worker may be bound to the production D1.");
      process.exit(1);
    }
    console.log("  _test_marker = e2e-test-db ✓");
  } catch (err) {
    console.error(`FATAL: _test_marker check failed: ${err}`);
    process.exit(1);
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

    // Step 4b: Initialize D1 schema (idempotent, required for local D1)
    await initSchema();

    // Step 4c: Warm up D1
    await warmupD1();

    // Step 4d: Refuse to run if the bound D1 is not the test database
    await verifyTestMarker();

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
