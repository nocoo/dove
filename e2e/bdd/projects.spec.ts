import { test, expect } from "@playwright/test";

test.describe("Project CRUD", () => {
  test("create, view, and delete a project", async ({ page }) => {
    // Navigate to projects page
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

    // Click "New Project" button
    await page.getByRole("button", { name: "New Project" }).click();
    await expect(page).toHaveURL(/\/projects\/new/, { timeout: 10_000 });

    // Fill in the project form (labels from actual form snapshot)
    const projectName = `E2E Project ${Date.now()}`;
    await page.getByLabel("Name", { exact: true }).fill(projectName);
    await page.getByLabel("Email Prefix").fill("e2e-test");
    await page.getByLabel("Sender Display Name").fill("E2E App");

    // Submit — button becomes enabled after required fields are filled
    const createBtn = page.getByRole("button", { name: "Create Project" });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // Should redirect to project detail
    await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9_-]+$/, { timeout: 15_000 });

    // Verify project name is displayed
    await expect(page.getByText(projectName)).toBeVisible();

    // Navigate back to projects list and verify it appears
    await page.getByRole("link", { name: "Projects" }).first().click();
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

    // Go back to the project detail to delete
    await page.getByText(projectName).click();
    await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9_-]+$/, { timeout: 10_000 });

    // Delete the project — wait for detail page to fully load, then click delete
    const deleteBtn = page.getByRole("button", { name: "Delete Project" });
    await expect(deleteBtn).toBeVisible({ timeout: 15_000 });
    await deleteBtn.click();

    // Confirm deletion in the dialog — the confirm button says "Delete"
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.getByRole("button", { name: "Delete" }).click();

    // Should redirect to projects list
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });
  });
});
