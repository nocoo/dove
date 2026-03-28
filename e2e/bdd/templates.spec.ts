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

    // Verify template name is displayed (detail page loads data from D1)
    await expect(page.getByText(templateName)).toBeVisible({ timeout: 20_000 });

    // Cleanup: delete the project (cascades to template)
    await page.request.delete(`/api/projects/${project.id}`);
  });

  test("edit and preview a template", async ({ page }) => {
    // Setup: create project + template via API
    const projectRes = await page.request.post("/api/projects", {
      data: {
        name: `E2E Edit Project ${Date.now()}`,
        email_prefix: "e2e-edit",
        from_name: "E2E Edit App",
      },
    });
    expect(projectRes.ok()).toBeTruthy();
    const project = (await projectRes.json()) as { id: string };

    const tmplRes = await page.request.post("/api/templates", {
      data: {
        project_id: project.id,
        name: `E2E Edit Template ${Date.now()}`,
        slug: `e2e-edit-${Date.now()}`,
        subject: "Original Subject {{name}}",
        body_markdown: "# Hello {{name}}\n\nOriginal body.",
        variables: [{ name: "name", type: "string", required: true }],
      },
    });
    expect(tmplRes.ok()).toBeTruthy();
    const tmpl = (await tmplRes.json()) as { id: string };

    // Navigate to template detail
    await page.goto(`/templates/${tmpl.id}`);

    // Wait for form to load (Subject input should contain original value)
    const subjectInput = page.getByLabel("Subject");
    await expect(subjectInput).toBeVisible({ timeout: 20_000 });
    await expect(subjectInput).toHaveValue("Original Subject {{name}}");

    // No dirty bar initially
    await expect(page.getByText("You have unsaved changes.")).not.toBeVisible();

    // Edit the subject field
    await subjectInput.fill("Updated Subject {{name}}");

    // Dirty bar should appear
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();

    // Save changes
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Dirty bar should disappear after save
    await expect(page.getByText("You have unsaved changes.")).not.toBeVisible({
      timeout: 10_000,
    });

    // Fill sample variable for preview (template has required "name" variable)
    await page.getByPlaceholder("required").fill("World");

    // Click Render to preview
    await page.getByRole("button", { name: "Render" }).click();

    // Preview should show rendered HTML in .prose container
    const prose = page.locator(".prose");
    await expect(prose).toBeVisible({ timeout: 15_000 });
    await expect(prose).toContainText("Hello World");

    // Cleanup
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
