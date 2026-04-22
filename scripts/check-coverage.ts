/**
 * Coverage check script — runs tests with --coverage and validates threshold.
 *
 * Exit 0 if coverage ≥ threshold, exit 1 otherwise.
 *
 * Note: Bun test's coverage reporter only emits function and line metrics
 * (no branch data in lcov, no BRDA/BRF/BRH records). Branch coverage is
 * therefore not gated here. We compensate by setting a higher line/function
 * threshold than typical (95% vs the more common 80–90%) to catch regressions.
 *
 * Note: Bun writes the coverage table to stderr, not stdout — parse stderr.
 */

export const THRESHOLD = 95;

async function main() {
  const proc = Bun.spawn(["bun", "test", "src/__tests__/", "--coverage"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ENABLE_DOM_TESTS: "1" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (exitCode !== 0) {
    console.error("\nTests failed — cannot check coverage.");
    process.exit(1);
  }

  // Coverage table is on stderr; format: "All files | XX.XX | XX.XX | ..."
  const match = stderr.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) {
    console.error("\nCould not parse coverage from test output.");
    console.error("Make sure bun test --coverage is producing a coverage table.\n");
    process.exit(1);
  }

  const functionCov = parseFloat(match[1] ?? "0");
  const lineCov = parseFloat(match[2] ?? "0");

  console.log(`\n--- Coverage Check ---`);
  console.log(`Function coverage: ${functionCov}%`);
  console.log(`Line coverage:     ${lineCov}%`);
  console.log(`Threshold:         ${THRESHOLD}%`);

  if (functionCov < THRESHOLD || lineCov < THRESHOLD) {
    console.error(`\nCoverage below ${THRESHOLD}% threshold. Please add more tests.\n`);
    process.exit(1);
  }

  console.log(`\nCoverage check passed.\n`);
}

void main();
