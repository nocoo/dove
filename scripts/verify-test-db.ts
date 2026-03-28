/**
 * Verify the connected D1 database is the test instance.
 *
 * Safety checks before any E2E test run:
 *   1. Inequality check: D1_WORKER_URL in .env.test !== D1_WORKER_URL in .env.local
 *   2. _test_marker verification: SELECT value FROM _test_marker WHERE key='env' === 'test'
 *
 * Exits non-zero on failure — E2E suite must not run against production.
 *
 * Usage:
 *   bun run scripts/verify-test-db.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env file into a key-value map. */
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

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");

  // ── 1. Load .env.test ──
  const envTestPath = resolve(root, ".env.test");
  let testVars: Map<string, string>;
  try {
    testVars = loadEnvFile(envTestPath);
  } catch {
    console.error("ERROR: .env.test not found. Create it first.");
    console.error("  See docs/02-quality-upgrade.md Step 3 for format.");
    process.exit(1);
  }

  const testUrl = testVars.get("D1_WORKER_URL");
  const testApiKey = testVars.get("D1_WORKER_API_KEY");

  if (!testUrl || !testApiKey) {
    console.error(
      "ERROR: .env.test must define D1_WORKER_URL and D1_WORKER_API_KEY",
    );
    process.exit(1);
  }

  // ── 2. Inequality check: test URL !== production URL ──
  let prodUrl: string | undefined;
  try {
    const prodVars = loadEnvFile(resolve(root, ".env.local"));
    prodUrl = prodVars.get("D1_WORKER_URL");
  } catch {
    // .env.local may not exist in CI — skip inequality check
    console.log(
      "WARN: .env.local not found, skipping inequality check (OK in CI).",
    );
  }

  if (prodUrl && testUrl === prodUrl) {
    console.error("FATAL: D1_WORKER_URL in .env.test matches .env.local!");
    console.error(`  Both point to: ${testUrl}`);
    console.error(
      "  Test and production Worker URLs MUST be different.",
    );
    process.exit(1);
  }

  if (prodUrl) {
    console.log(`Inequality check passed: ${testUrl} !== ${prodUrl}`);
  }

  // ── 3. Query _test_marker ──
  console.log(`Verifying _test_marker on ${testUrl}...`);

  const response = await fetch(`${testUrl}/query`, {
    method: "POST",
    headers: {
      "X-API-Key": testApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: "SELECT value FROM _test_marker WHERE key = 'env'",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`ERROR: Worker returned ${response.status}: ${text}`);
    console.error(
      "  Have you run `bun run scripts/deploy-test-worker.ts` to seed the test DB?",
    );
    process.exit(1);
  }

  const data = (await response.json()) as {
    success: boolean;
    results?: { value: string }[];
    error?: string;
  };

  if (!data.success) {
    console.error(`ERROR: Query failed: ${data.error ?? "unknown"}`);
    process.exit(1);
  }

  if (!data.results?.length || data.results[0].value !== "test") {
    console.error(
      "FATAL: _test_marker not found or value !== 'test'.",
    );
    console.error(
      "  This database is NOT a test instance. Refusing to run E2E.",
    );
    console.error(
      "  Run `bun run scripts/deploy-test-worker.ts --seed-only` to seed.",
    );
    process.exit(1);
  }

  console.log("_test_marker verified: env=test");
  console.log("Test database verification passed.\n");
}

void main();
