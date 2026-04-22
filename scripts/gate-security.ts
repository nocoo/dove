/**
 * G2: Security gate — osv-scanner + gitleaks.
 *
 * Default invocation runs both. Pass `--secrets` to run gitleaks only
 * (used in pre-commit), or `--deps` to run osv-scanner only (used in
 * pre-push). Splitting lets us catch leaked secrets before they land
 * in a local commit instead of waiting until push.
 *
 * Hard fail if tools are not installed — no soft-skip.
 */

async function runCommand(cmd: string[], label: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`\n${label} FAILED (exit ${exitCode}):`);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      return false;
    }

    console.log(`${label}: passed`);
    return true;
  } catch {
    console.error(`${label}: tool not installed. Install it to pass the security gate.`);
    console.error(`  osv-scanner: https://github.com/google/osv-scanner`);
    console.error(`  gitleaks: https://github.com/gitleaks/gitleaks`);
    return false;
  }
}

const GITLEAKS = (): Promise<boolean> =>
  runCommand(
    ["gitleaks", "protect", "--staged", "--no-banner", "--redact"],
    "gitleaks (staged secret detection)",
  );

const OSV = (): Promise<boolean> =>
  runCommand(["osv-scanner", "--lockfile=bun.lock"], "osv-scanner (dependency vulnerabilities)");

async function main() {
  const arg = process.argv[2];
  console.log("--- Security Gate ---\n");

  let tasks: Array<() => Promise<boolean>>;
  if (arg === "--secrets") {
    tasks = [GITLEAKS];
  } else if (arg === "--deps") {
    tasks = [OSV];
  } else {
    tasks = [OSV, GITLEAKS];
  }

  const results = await Promise.all(tasks.map((t) => t()));
  const allPassed = results.every(Boolean);

  if (!allPassed) {
    console.error("\nSecurity gate FAILED.\n");
    process.exit(1);
  }

  console.log("\nSecurity gate passed.\n");
}

void main();
