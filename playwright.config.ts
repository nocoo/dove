import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for L3 BDD E2E tests.
 *
 * Uses port 27046 (isolated from dev=7046 and L2=17046).
 * Auth is bypassed via E2E_SKIP_AUTH=true.
 *
 * Env injection: The webServer command uses ${VAR:?msg} syntax
 * to fail-closed if test Worker credentials are missing.
 * Set D1_WORKER_URL_TEST and D1_WORKER_API_KEY_TEST in your
 * shell environment or CI config.
 */
export default defineConfig({
  testDir: "./e2e/bdd",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: "html",
  use: {
    baseURL: "http://localhost:27046",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: [
      "D1_WORKER_URL=${D1_WORKER_URL_TEST:?not set}",
      "D1_WORKER_API_KEY=${D1_WORKER_API_KEY_TEST:?not set}",
      "E2E_SKIP_AUTH=true",
      "npx next dev --port 27046",
    ].join(" "),
    port: 27046,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
