import { test, expect } from "@playwright/test";

test.describe("Template CRUD", () => {
  test("create and view a template", async ({ page }) => {
    // First, ensure a project exists (templates need a project)
    // Create one via API for speed
    const projectRes = await page.request.post("/api/projects", {
      data: {
        name: `E2E Template Project ${Date.now()}`,
        email_prefix: "e2e-tmpl",
        from_name: "E2E App",
      },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = await projectRes.json();

    // Navigate to templates page
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();

    // Click "New Template"
    await page.getByRole("link", { name: "New Template" }).click();
    await expect(page).toHaveURL(/\/templates\/new/);

    // Fill the template form
    const templateName = `E2E Template ${Date.now()}`;
    const slug = `e2e-tmpl-${Date.now()}`;

    await page.getByLabel("Template Name").fill(templateName);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Subject").fill("Hello {{name}}");

    // Select the project (if dropdown exists)
    const projectSelect = page.getByLabel("Project");
    if (await projectSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectSelect.selectOption({ label: project.name });
    }

    // Fill markdown body
    const bodyField = page.getByLabel("Body");
    if (await bodyField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bodyField.fill("# Hi {{name}}\n\nWelcome!");
    }

    // Submit
    await page.getByRole("button", { name: /create template/i }).click();

    // Should redirect to template detail or templates list
    await page.waitForURL(/\/templates/, { timeout: 10_000 });

    // Verify template appears somewhere
    await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 });

    // Cleanup: delete the project (cascades to template)
    await page.request.delete(`/api/projects/${project.id}`);
  });

  test("templates list page renders", async ({ page }) => {
    await page.goto("/templates");

    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();

    // Should show either template list or empty state
    const hasTemplates = await page.getByText("New Template").isVisible();
    expect(hasTemplates).toBeTruthy();
  });
});
