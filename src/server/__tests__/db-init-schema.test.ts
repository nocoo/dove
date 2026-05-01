/**
 * Drift guard: src/server/routes/db-init.ts inlines a SCHEMA_SQL string
 * used by /db-init to bootstrap fresh local databases. It must stay in
 * lockstep with src/server/schema.sql — if a column is added to one but
 * not the other, fresh-DB callers (e.g. e2e harness, brand-new local
 * dev DB) will hit `no such column: <X>` the first time createProject()
 * (or any other writer) executes against the new shape.
 *
 * This test pins:
 *   (1) the projects table column set is identical between schema.sql and
 *       db-init.ts SCHEMA_SQL (covers the Phase 4a regression that added
 *       allow_unknown_recipients to schema.sql + the migration but missed
 *       db-init.ts).
 *   (2) allow_unknown_recipients specifically appears in BOTH places with
 *       its DEFAULT 0 — a regression that flipped the default in either
 *       file would silently open up the whitelist for fresh DBs.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function extractCreateProjectsBody(source: string): string {
  // Match `CREATE TABLE [IF NOT EXISTS] projects (...);` greedily up to
  // the first closing paren+semicolon. Schemas here are flat — no nested
  // parens inside column defs that would break this.
  const match = source.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?projects\s*\(([\s\S]*?)\)\s*;/i,
  );
  if (!match) throw new Error("CREATE TABLE projects (...) not found");
  return match[1]!;
}

function extractColumnNames(body: string): string[] {
  const cols: string[] = [];
  for (const rawLine of body.split("\n")) {
    // Strip trailing comments and whitespace.
    const line = rawLine.replace(/--.*$/, "").trim().replace(/,$/, "").trim();
    if (!line) continue;
    // Skip table-level constraints (UNIQUE(...), PRIMARY KEY(...), CHECK(...), FOREIGN KEY(...)).
    if (/^(UNIQUE|PRIMARY\s+KEY|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i.test(line)) continue;
    // First whitespace-delimited token is the column name.
    const name = line.split(/\s+/)[0];
    if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) cols.push(name);
  }
  return cols;
}

describe("db-init.ts SCHEMA_SQL ↔ schema.sql drift guard", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  const canonicalSchema = readFileSync(
    join(repoRoot, "src", "server", "schema.sql"),
    "utf8",
  );
  const dbInitSource = readFileSync(
    join(repoRoot, "src", "server", "routes", "db-init.ts"),
    "utf8",
  );

  test("projects column set is identical between schema.sql and db-init.ts", () => {
    const canonicalCols = extractColumnNames(extractCreateProjectsBody(canonicalSchema)).sort();
    const dbInitCols = extractColumnNames(extractCreateProjectsBody(dbInitSource)).sort();
    expect(dbInitCols).toEqual(canonicalCols);
  });

  test("allow_unknown_recipients exists in BOTH schemas with DEFAULT 0", () => {
    // SECURITY: a regression that changed the default to 1 in either file
    // would silently open the whitelist bypass for every NEW project on
    // fresh DBs — disastrous for tenants relying on the whitelist gate.
    const re = /allow_unknown_recipients\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i;
    expect(canonicalSchema).toMatch(re);
    expect(dbInitSource).toMatch(re);
  });
});
