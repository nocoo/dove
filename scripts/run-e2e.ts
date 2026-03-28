/**
 * L2: API E2E test runner with full server lifecycle.
 *
 * Steps:
 *   1. Load .env.test — hard fail if missing
 *   2. Inequality check — test URL !== production URL
 *   3. Verify test DB marker (_test_marker)
 *   4. Clean .next/dev/lock (stale lock prevents parallel dev servers)
 *   5. Spawn `next dev --port 17046` with E2E env
 *   6. Wait for server ready (poll /api/live)
 *   7. Run `bun test e2e/api/`
 *   8. Kill server
 *   9. Exit with test exit code
 *
 * Usage:
 *   bun run scripts/run-e2e.ts
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { Subprocess } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const E2E_PORT = 17046;
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
// Step 3: Verify test DB marker
// ---------------------------------------------------------------------------

async function verifyTestDb(): Promise<void> {
  console.log("\nStep 3: Verifying test DB...");
  const script = resolve(import.meta.dirname, "verify-test-db.ts");
  const proc = Bun.spawn(["bun", "run", script], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("FATAL: Test DB verification failed. Aborting E2E.\n");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Clean .next/dev/lock
// ---------------------------------------------------------------------------

function cleanDevLock(): void {
  const lockPath = resolve(ROOT, ".next/dev/lock");
  if (existsSync(lockPath)) {
    console.log("  Removing stale .next/dev/lock...");
    unlinkSync(lockPath);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Spawn dev server
// ---------------------------------------------------------------------------

function spawnDevServer(envVars: Map<string, string>): Subprocess {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  // Inject test environment variables
  for (const [key, value] of envVars) {
    env[key] = value;
  }
  env.NODE_ENV = "development";
  env.PORT = String(E2E_PORT);

  console.log(`\nStep 5: Starting dev server on port ${E2E_PORT}...`);

  const proc = Bun.spawn(
    ["npx", "next", "dev", "--port", String(E2E_PORT)],
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
// Step 6: Wait for server ready
// ---------------------------------------------------------------------------

async function waitForServer(): Promise<void> {
  const url = `http://localhost:${E2E_PORT}/api/live`;
  const start = Date.now();

  console.log(`Step 6: Waiting for server at ${url}...`);

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json() as { status: string; d1: boolean };
        if (body.status === "ok" && body.d1) {
          console.log(`  Server ready (${Date.now() - start}ms)`);
          return;
        }
        console.log(`  Server responded but not ready: ${JSON.stringify(body)}`);
      }
    } catch {
      // Server not up yet — expected during startup
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  console.error(`FATAL: Server did not start within ${MAX_WAIT_MS}ms`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 6b: Warm up D1 connection
// ---------------------------------------------------------------------------

async function warmupD1(): Promise<void> {
  console.log("Step 6b: Warming up D1 connection...");
  const start = Date.now();
  try {
    const res = await fetch(`http://localhost:${E2E_PORT}/api/projects`, {
      signal: AbortSignal.timeout(15_000),
    });
    await res.text(); // drain body
    console.log(`  D1 warm (${Date.now() - start}ms, status=${res.status})`);
  } catch (err) {
    console.log(`  WARN: D1 warmup call failed (${Date.now() - start}ms): ${err}`);
    // Non-fatal — tests will retry on their own
  }
}

// ---------------------------------------------------------------------------
// Step 7: Run tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<number> {
  console.log("\nStep 7: Running E2E tests...\n");

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

  // Step 3: Verify test DB
  await verifyTestDb();

  // Step 4: Clean stale lock
  console.log("\nStep 4: Cleaning .next/dev/lock...");
  cleanDevLock();

  // Step 5: Spawn dev server
  const server = spawnDevServer(envVars);

  let testExitCode = 1;

  try {
    // Step 6: Wait for ready
    await waitForServer();

    // Step 6b: Warm up D1 (avoid cold-start timeouts in tests)
    await warmupD1();

    // Step 7: Run tests
    testExitCode = await runTests();
  } finally {
    // Step 8: Kill server
    console.log("\nStep 8: Stopping dev server...");
    server.kill();
    await server.exited;
    console.log("  Server stopped.");
  }

  // Step 9: Exit
  if (testExitCode !== 0) {
    console.error("\n=== E2E tests FAILED ===\n");
    process.exit(1);
  }

  console.log("\n=== E2E tests PASSED ===\n");
}

void main();
