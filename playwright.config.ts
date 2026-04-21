import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for L3 BDD E2E tests.
 *
 * Uses port 27034 (isolated from dev=7034 and L2=17034).
 * Auth is bypassed via localhost detection (no CF Access on localhost).
 *
 * D1 isolation: wrangler --env test uses dove-db-test (local SQLite in dev,
 * separate database_id from production). Email sending is disabled via
 * EMAIL_DRY_RUN + RESEND_DRY_RUN env vars.
 */
export default defineConfig({
  testDir: "./e2e/bdd",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    baseURL: "http://localhost:27034",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: [
      "EMAIL_DRY_RUN=true",
      "RESEND_DRY_RUN=true",
      "npx wrangler dev --env test --port 27034",
    ].join(" "),
    port: 27034,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
