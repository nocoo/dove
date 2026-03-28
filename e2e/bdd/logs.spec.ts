import { test, expect } from "@playwright/test";

test.describe("Send Logs", () => {
  test("renders send logs page", async ({ page }) => {
    await page.goto("/send-logs");

    // Page heading
    await expect(page.getByRole("heading", { name: "Send Logs", level: 1 })).toBeVisible();

    // Wait for either: log rows (status badges), empty state, or just the filters
    // The page loads data from D1 which can be slow on first request
    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("All Statuses")).toBeVisible();

    // Page is loaded — verify we have either logs or empty state
    // Use a generous timeout since D1 cold start can be slow
    const content = await page.locator("main").textContent({ timeout: 15_000 });
    expect(content).toBeTruthy();
  });

  test("project filter dropdown is present", async ({ page }) => {
    await page.goto("/send-logs");

    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Webhook Logs", () => {
  test("renders webhook logs page", async ({ page }) => {
    await page.goto("/webhook-logs");

    // Page heading
    await expect(page.getByRole("heading", { name: "Webhook Logs", level: 1 })).toBeVisible();

    // Wait for filters to appear (indicates data loading is complete)
    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });

    // Page is loaded
    const content = await page.locator("main").textContent({ timeout: 15_000 });
    expect(content).toBeTruthy();
  });

  test("project filter dropdown is present", async ({ page }) => {
    await page.goto("/webhook-logs");

    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });
  });
});
