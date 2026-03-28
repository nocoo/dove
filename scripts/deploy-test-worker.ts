/**
 * Deploy test Worker and seed full schema into dove-db-test.
 *
 * One-shot script for setting up the E2E test D1 instance.
 * Replays the FULL schema (tables + indexes + partial index)
 * through the test Worker's /query endpoint, then seeds _test_marker.
 *
 * Prerequisites:
 *   1. wrangler CLI installed and authenticated
 *   2. .env.test exists with D1_WORKER_URL and D1_WORKER_API_KEY
 *
 * Usage:
 *   bun run scripts/deploy-test-worker.ts
 *   bun run scripts/deploy-test-worker.ts --seed-only  # skip wrangler deploy
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCHEMA_SQL, PARTIAL_INDEX_SQL } from "../src/lib/db/schema";

const TEST_MARKER_SQL = `
CREATE TABLE IF NOT EXISTS _test_marker (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const TEST_MARKER_SEED =
  "INSERT OR IGNORE INTO _test_marker (key, value) VALUES ('env', 'test')";

/** Load .env.test into a key-value map. */
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

/** Send a SQL statement to the test Worker. */
async function executeSql(
  workerUrl: string,
  apiKey: string,
  sql: string,
): Promise<void> {
  const response = await fetch(`${workerUrl}/query`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { success: boolean; error?: string };
  if (!data.success) {
    throw new Error(`SQL failed: ${data.error ?? "unknown"}`);
  }
}

async function deployWorker(): Promise<void> {
  console.log("Deploying test Worker (wrangler deploy --env test)...");
  const proc = Bun.spawn(["wrangler", "deploy", "--env", "test"], {
    cwd: resolve(import.meta.dirname, "../worker"),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`wrangler deploy failed with exit code ${exitCode}`);
  }
  console.log("Test Worker deployed.\n");
}

async function seedSchema(
  workerUrl: string,
  apiKey: string,
): Promise<void> {
  // Split SCHEMA_SQL into individual statements (same logic as initializeSchema)
  const schemaStatements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const allStatements = [
    ...schemaStatements,
    PARTIAL_INDEX_SQL,
    TEST_MARKER_SQL,
    TEST_MARKER_SEED,
  ];

  console.log(`Seeding ${allStatements.length} SQL statements...\n`);

  for (let i = 0; i < allStatements.length; i++) {
    const sql = allStatements[i];
    const label = sql.slice(0, 60).replace(/\s+/g, " ").trim();
    process.stdout.write(`  [${i + 1}/${allStatements.length}] ${label}...`);
    await executeSql(workerUrl, apiKey, sql);
    console.log(" ok");
  }

  console.log("\nSchema seeded successfully.");
}

async function main(): Promise<void> {
  const seedOnly = process.argv.includes("--seed-only");

  // Load .env.test
  const envPath = resolve(import.meta.dirname, "../.env.test");
  let envVars: Map<string, string>;
  try {
    envVars = loadEnvFile(envPath);
  } catch {
    console.error("ERROR: .env.test not found. Create it first with:");
    console.error("  D1_WORKER_URL=https://dove-test.worker.hexly.ai");
    console.error("  D1_WORKER_API_KEY=<your-test-api-key>");
    process.exit(1);
  }

  const workerUrl = envVars.get("D1_WORKER_URL");
  const apiKey = envVars.get("D1_WORKER_API_KEY");

  if (!workerUrl || !apiKey) {
    console.error("ERROR: .env.test must define D1_WORKER_URL and D1_WORKER_API_KEY");
    process.exit(1);
  }

  console.log(`Test Worker URL: ${workerUrl}\n`);

  // Step 1: Deploy (unless --seed-only)
  if (!seedOnly) {
    await deployWorker();
  } else {
    console.log("Skipping deploy (--seed-only).\n");
  }

  // Step 2: Seed schema
  await seedSchema(workerUrl, apiKey);

  // Step 3: Verify marker
  console.log("\nVerifying _test_marker...");
  const verifyResponse = await fetch(`${workerUrl}/query`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: "SELECT value FROM _test_marker WHERE key = 'env'",
    }),
  });
  const verifyData = (await verifyResponse.json()) as {
    success: boolean;
    results?: { value: string }[];
  };

  if (
    !verifyData.success ||
    !verifyData.results?.length ||
    verifyData.results[0].value !== "test"
  ) {
    console.error("ERROR: _test_marker verification failed!");
    process.exit(1);
  }

  console.log("_test_marker verified: env=test");
  console.log("\nDone. Test Worker is ready for E2E.\n");
}

void main();
