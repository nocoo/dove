import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper: create a project + recipient + template + fire a webhook send
// to populate both send_logs and webhook_logs in the test DB.
// ---------------------------------------------------------------------------

async function createLogData(request: import("@playwright/test").APIRequestContext) {
  const projRes = await request.post("/api/projects", {
    data: {
      name: `E2E Log Project ${Date.now()}`,
      email_prefix: "e2e-log",
      from_name: "E2E Log App",
    },
  });
  const project = (await projRes.json()) as {
    id: string;
    name: string;
    webhook_token: string;
  };

  const recipEmail = `e2e-log-${Date.now()}@example.com`;
  const recipRes = await request.post("/api/recipients", {
    data: {
      project_id: project.id,
      name: `E2E Log User ${Date.now()}`,
      email: recipEmail,
    },
  });
  const recipient = (await recipRes.json()) as { email: string };

  const tmplRes = await request.post("/api/templates", {
    data: {
      project_id: project.id,
      name: `E2E Log Template ${Date.now()}`,
      slug: `e2e-log-${Date.now()}`,
      subject: "Log test {{name}}",
      body_markdown: "# Hi {{name}}",
      variables: [{ name: "name", type: "string", required: true }],
    },
  });
  const tmpl = (await tmplRes.json()) as { slug: string };

  // Fire a webhook send (RESEND_DRY_RUN=true → no real email, but logs are created)
  await request.post(`/api/webhook/${project.id}/send`, {
    headers: { Authorization: `Bearer ${project.webhook_token}` },
    data: {
      to: recipient.email,
      template: tmpl.slug,
      variables: { name: "World" },
    },
  });

  return { project, recipient };
}

// ---------------------------------------------------------------------------
// Send Logs
// ---------------------------------------------------------------------------

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

  test("filters send logs by project", async ({ page }) => {
    // Create log data via API
    const { project, recipient } = await createLogData(page.request);

    await page.goto("/send-logs");
    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });

    // Verify our log row is visible (recipient email in table)
    await expect(page.getByText(recipient.email)).toBeVisible({ timeout: 10_000 });

    // Open the project filter and select our project
    const projectFilter = page.locator("button").filter({ hasText: "All Projects" });
    await projectFilter.click();
    await page.getByRole("option", { name: project.name }).click();

    // Row should still be visible after filtering
    await expect(page.getByText(recipient.email)).toBeVisible({ timeout: 10_000 });

    // "Clear filters" button should appear
    await expect(page.getByRole("button", { name: /clear filters/i })).toBeVisible();

    // Cleanup
    await page.request.delete(`/api/projects/${project.id}`);
  });
});

// ---------------------------------------------------------------------------
// Webhook Logs
// ---------------------------------------------------------------------------

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

  test("expands webhook log row to show detail", async ({ page }) => {
    // Create log data via API (also creates a webhook_log)
    const { project } = await createLogData(page.request);

    await page.goto("/webhook-logs");
    await expect(page.getByText("All Projects")).toBeVisible({ timeout: 15_000 });

    // Find a POST row and click to expand
    const postRow = page.locator("button").filter({ hasText: "POST" }).first();
    await expect(postRow).toBeVisible({ timeout: 10_000 });
    await postRow.click();

    // Expanded detail should show "ID" and "Created" labels
    await expect(page.getByText("ID", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Created")).toBeVisible();

    // Cleanup
    await page.request.delete(`/api/projects/${project.id}`);
  });
});
