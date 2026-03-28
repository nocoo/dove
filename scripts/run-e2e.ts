/**
 * L2: API E2E test runner.
 *
 * Runs API-level end-to-end tests against a running dev server.
 * Placeholder — E2E tests will be added as integration tests mature.
 */

async function main() {
  console.log("--- L2: API E2E Tests ---\n");

  // Check if the E2E test directory exists
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
