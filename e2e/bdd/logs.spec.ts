import { test, expect } from "@playwright/test";

test.describe("Send Logs", () => {
  test("renders send logs page with table or empty state", async ({ page }) => {
    await page.goto("/send-logs");

    await expect(page.getByRole("heading", { name: "Send Logs", level: 1 })).toBeVisible();

    // Should show either log rows or empty state
    const hasLogs = await page.getByText("sent").first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no send logs/i).isVisible({ timeout: 1000 }).catch(() => false);

    expect(hasLogs || hasEmpty).toBeTruthy();
  });

  test("project filter dropdown is present", async ({ page }) => {
    await page.goto("/send-logs");

    // Filter select should be visible
    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Webhook Logs", () => {
  test("renders webhook logs page with table or empty state", async ({ page }) => {
    await page.goto("/webhook-logs");

    await expect(page.getByRole("heading", { name: "Webhook Logs", level: 1 })).toBeVisible();

    // Should show either log rows or empty state
    const hasLogs = await page.getByText("POST").first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no webhook logs/i).isVisible({ timeout: 1000 }).catch(() => false);

    expect(hasLogs || hasEmpty).toBeTruthy();
  });

  test("project filter dropdown is present", async ({ page }) => {
    await page.goto("/webhook-logs");

    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 10_000 });
  });
});
