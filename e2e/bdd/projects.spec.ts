import { test, expect } from "@playwright/test";

test.describe("Project CRUD", () => {
  test("create, view, and delete a project", async ({ page }) => {
    // Navigate to projects page
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

    // Click "New Project" button
    await page.getByRole("link", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/new/);

    // Fill in the project form
    const projectName = `E2E Project ${Date.now()}`;
    await page.getByLabel("Project Name").fill(projectName);
    await page.getByLabel("Email Prefix").fill("e2e-test");
    await page.getByLabel("From Name").fill("E2E App");

    // Submit
    await page.getByRole("button", { name: "Create Project" }).click();

    // Should redirect to project detail
    await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9_-]+$/);

    // Verify project name is displayed
    await expect(page.getByText(projectName)).toBeVisible();

    // Navigate back to projects list and verify it appears
    await page.getByRole("link", { name: "Projects" }).first().click();
    await expect(page.getByText(projectName)).toBeVisible();

    // Go back to the project detail to delete
    await page.getByText(projectName).click();
    await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9_-]+$/);

    // Delete the project
    await page.getByRole("button", { name: /delete/i }).click();

    // Confirm deletion if there's a dialog
    const confirmButton = page.getByRole("button", { name: /confirm|delete/i }).last();
    if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.click();
    }

    // Should redirect to projects list
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });
  });
});
