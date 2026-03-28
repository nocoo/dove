/**
 * L2: API E2E test runner.
 *
 * Runs API-level end-to-end tests against a running dev server.
 *
 * Steps:
 *   1. Verify test DB is the correct instance (scripts/verify-test-db.ts)
 *   2. Run E2E test suite
 *
 * This runner will be fully rewritten in Step 4 to auto-start/stop
 * a dev server on port 17046. For now it adds the verify-test-db gate.
 */

import { resolve } from "node:path";

async function verifyTestDb(): Promise<void> {
  console.log("Verifying test database...\n");

  const script = resolve(import.meta.dirname, "verify-test-db.ts");
  const proc = Bun.spawn(["bun", "run", script], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("Test DB verification FAILED. Aborting E2E.\n");
    process.exit(1);
  }
}

async function main() {
  console.log("--- L2: API E2E Tests ---\n");

  // Step 1: Verify test DB identity
  await verifyTestDb();

  // Step 2: Run E2E tests
  const e2eDir = "e2e/api";
  const exists = await Bun.file(`${e2eDir}/health.test.ts`).exists();

  if (!exists) {
    console.log("No E2E tests found yet. Skipping.\n");
    console.log("To add E2E tests, create files in e2e/api/\n");
    return;
  }

  const proc = Bun.spawn(["bun", "test", e2eDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (exitCode !== 0) {
    console.error("\nE2E tests FAILED.\n");
    process.exit(1);
  }

  console.log("\nE2E tests passed.\n");
}

void main();
