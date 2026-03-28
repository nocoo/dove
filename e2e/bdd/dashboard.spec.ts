import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders stats cards and chart", async ({ page }) => {
    await page.goto("/");

    // Page heading
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    // Skeleton should appear on initial load (before D1 response).
    // Race: if D1 is fast the skeleton may vanish before we check,
    // so we look for EITHER the skeleton OR the loaded chart title.
    const skeleton = page.locator("[data-slot='skeleton']").first();
    const chartTitle = page.getByText("Sends Over Time");
    await expect(skeleton.or(chartTitle)).toBeVisible({ timeout: 15_000 });

    // Wait for real content to replace skeleton — stats cards must appear
    await expect(page.getByText("Sent Today")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Sent This Month")).toBeVisible();
    await expect(page.getByText("Failed Today")).toBeVisible();

    // Chart must render — verify Recharts container is in the DOM
    await expect(chartTitle).toBeVisible({ timeout: 15_000 });
    const chartContainer = page.locator(".recharts-responsive-container");
    await expect(chartContainer).toBeVisible({ timeout: 10_000 });

    // Skeleton must be gone once chart is visible
    await expect(skeleton).not.toBeVisible();
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/");

    // Navigate to Projects via sidebar
    await page.getByRole("link", { name: "Projects" }).first().click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

    // Navigate to Templates
    await page.getByRole("link", { name: "Templates" }).first().click();
    await expect(page).toHaveURL(/\/templates/);
    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();

    // Navigate to Send Logs
    await page.getByRole("link", { name: "Send Logs" }).first().click();
    await expect(page).toHaveURL(/\/send-logs/);
    await expect(page.getByRole("heading", { name: "Send Logs", level: 1 })).toBeVisible();

    // Navigate to Webhook Logs
    await page.getByRole("link", { name: "Webhook Logs" }).first().click();
    await expect(page).toHaveURL(/\/webhook-logs/);
    await expect(page.getByRole("heading", { name: "Webhook Logs", level: 1 })).toBeVisible();

    // Navigate back to Dashboard
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/");
  });
});

test.describe("Login page", () => {
  test("renders sign-in button", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByText("Sign in with Google")).toBeVisible();
    await expect(page.getByText("Sign in to your email relay")).toBeVisible();
  });
});
