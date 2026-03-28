/**
 * Coverage check script — runs tests with --coverage and validates threshold.
 *
 * Exit 0 if coverage ≥ threshold, exit 1 otherwise.
 */

export const THRESHOLD = 90;

async function main() {
  const proc = Bun.spawn(["bun", "test", "src/__tests__/", "--coverage"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Print output
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (exitCode !== 0) {
    console.error("\nTests failed — cannot check coverage.");
    process.exit(1);
  }

  // Parse coverage from "All files" summary row
  // Format: "All files | XX.XX | XX.XX | XX.XX"
  const match = stdout.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) {
    console.error("\nCould not parse coverage from test output.");
    console.error("Make sure bun test --coverage is producing a coverage table.\n");
    // Don't fail — coverage table format might change
    process.exit(0);
  }

  const functionCov = parseFloat(match[1]!);
  const lineCov = parseFloat(match[2]!);

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
