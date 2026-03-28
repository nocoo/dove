/**
 * G2: Security gate — osv-scanner + gitleaks.
 *
 * Checks for known vulnerabilities in dependencies (osv-scanner)
 * and leaked secrets in the codebase (gitleaks).
 *
 * Both tools are optional — if not installed, warns and skips.
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
    console.warn(`${label}: tool not found — skipping (install for full security checks)`);
    return true; // Don't fail if tool not installed
  }
}

async function main() {
  console.log("--- Security Gate ---\n");

  const results = await Promise.all([
    runCommand(["osv-scanner", "--lockfile=bun.lock"], "osv-scanner (dependency vulnerabilities)"),
    runCommand(["gitleaks", "detect", "--source=.", "--no-banner"], "gitleaks (secret detection)"),
  ]);

  const allPassed = results.every(Boolean);

  if (!allPassed) {
    console.error("\nSecurity gate FAILED.\n");
    process.exit(1);
  }

  console.log("\nSecurity gate passed.\n");
}

void main();
