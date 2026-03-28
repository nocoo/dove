import { test, expect } from "@playwright/test";

test.describe("Template CRUD", () => {
  test("create and view a template", async ({ page }) => {
    // First, ensure a project exists (templates need a project)
    const projectRes = await page.request.post("/api/projects", {
      data: {
        name: `E2E Template Project ${Date.now()}`,
        email_prefix: "e2e-tmpl",
        from_name: "E2E App",
      },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = (await projectRes.json()) as { id: string; name: string };

    // Navigate to templates page
    await page.goto("/templates");
    await expect(
      page.getByRole("heading", { name: "Templates", level: 1 }),
    ).toBeVisible();

    // Click "New Template" button
    await page.getByRole("button", { name: "New Template" }).click();
    await expect(page).toHaveURL(/\/templates\/new/, { timeout: 10_000 });

    // Select project — shadcn Select renders as combobox, not native <select>
    const projectCombobox = page.getByRole("combobox").first();
    await projectCombobox.click();
    await page.getByRole("option", { name: project.name }).click();

    // Fill the template form (labels from actual page snapshot)
    const templateName = `E2E Template ${Date.now()}`;
    await page.getByLabel("Name", { exact: true }).fill(templateName);
    // Slug auto-generates from name, but fill explicitly
    await page.getByLabel("Slug").fill(`e2e-tmpl-${Date.now()}`);
    await page.getByLabel("Subject Line").fill("Hello {{name}}");
    await page.getByLabel("Body (Markdown)").fill("# Hi {{name}}\n\nWelcome!");

    // Submit — button becomes enabled after required fields are filled
    const createBtn = page.getByRole("button", { name: "Create Template" });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    // Should redirect to template detail
    await page.waitForURL(/\/templates\/[a-zA-Z0-9_-]+$/, { timeout: 15_000 });

    // Verify template name is displayed
    await expect(page.getByText(templateName)).toBeVisible({ timeout: 10_000 });

    // Cleanup: delete the project (cascades to template)
    await page.request.delete(`/api/projects/${project.id}`);
  });

  test("templates list page renders", async ({ page }) => {
    await page.goto("/templates");

    await expect(
      page.getByRole("heading", { name: "Templates", level: 1 }),
    ).toBeVisible();

    // Verify subtitle renders (proves page loaded beyond heading)
    await expect(
      page.getByText("Email templates across all projects"),
    ).toBeVisible();
  });
});
