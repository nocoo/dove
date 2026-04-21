import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders stats cards and chart", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    const skeleton = page.locator("[data-slot='skeleton']").first();
    const chartTitle = page.getByText("Sends Over Time");
    await expect(skeleton.or(chartTitle)).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Sent Today")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Sent This Month")).toBeVisible();
    await expect(page.getByText("Failed Today")).toBeVisible();

    await expect(chartTitle).toBeVisible({ timeout: 15_000 });
    const chartContainer = page.locator(".recharts-responsive-container");
    await expect(chartContainer).toBeVisible({ timeout: 10_000 });

    await expect(skeleton).not.toBeVisible();
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Projects" }).first().click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Templates" }).first().click();
    await expect(page).toHaveURL(/\/templates/);
    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Send Logs" }).first().click();
    await expect(page).toHaveURL(/\/send-logs/);
    await expect(page.getByRole("heading", { name: "Send Logs", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Webhook Logs" }).first().click();
    await expect(page).toHaveURL(/\/webhook-logs/);
    await expect(page.getByRole("heading", { name: "Webhook Logs", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/");
  });
});
