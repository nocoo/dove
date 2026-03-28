/**
 * E2E: Templates API — GET/POST /api/templates, GET/PUT/DELETE /api/templates/[id],
 *       POST /api/templates/[id]/preview
 *
 * Real HTTP against running dev server on port 17046.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  get,
  post,
  put,
  del,
  parseJson,
  setupTestProject,
  setupTestTemplate,
  cleanupProject,
} from "./helpers";

let projectId: string;

beforeAll(async () => {
  const project = await setupTestProject();
  projectId = project.id;
});

afterAll(async () => {
  await cleanupProject(projectId);
});

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe("GET /api/templates", () => {
  test("returns templates (optionally filtered by projectId)", async () => {
    const template = await setupTestTemplate(projectId);

    const response = await get("/api/templates", {
      searchParams: { projectId },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>[]>(response);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((t) => t.id === template.id);
    expect(found).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates
// ---------------------------------------------------------------------------

describe("POST /api/templates", () => {
  test("creates template with valid input", async () => {
    const slug = `e2e-create-${Date.now()}`;
    const response = await post("/api/templates", {
      body: {
        project_id: projectId,
        name: "New Template",
        slug,
        subject: "Hello {{name}}",
        body_markdown: "# Hi\n\nWelcome.",
        variables: [{ name: "name", type: "string", required: true }],
      },
    });

    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.slug).toBe(slug);
  });

  test("rejects invalid slug (uppercase, spaces)", async () => {
    const response = await post("/api/templates", {
      body: {
        project_id: projectId,
        name: "Bad Slug",
        slug: "Has Spaces!",
        subject: "Sub",
        body_markdown: "Body",
      },
    });
    expect(response.status).toBe(400);
  });

  test("returns 409 on duplicate slug", async () => {
    const slug = `e2e-dup-${Date.now()}`;

    // Create first
    await post("/api/templates", {
      body: {
        project_id: projectId,
        name: "First",
        slug,
        subject: "Sub",
        body_markdown: "Body",
      },
    });

    // Try duplicate
    const response = await post("/api/templates", {
      body: {
        project_id: projectId,
        name: "Dup",
        slug,
        subject: "Sub",
        body_markdown: "Body",
      },
    });
    expect(response.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/[id]
// ---------------------------------------------------------------------------

describe("GET /api/templates/[id]", () => {
  test("returns template when found", async () => {
    const template = await setupTestTemplate(projectId);

    const response = await get(`/api/templates/${template.id}`);
    expect(response.status).toBe(200);

    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.id).toBe(template.id);
    expect(body.slug).toBe(template.slug);
  });

  test("returns 404 when not found", async () => {
    const response = await get("/api/templates/nonexistent_id_12345");
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/templates/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/templates/[id]", () => {
  test("updates template", async () => {
    const template = await setupTestTemplate(projectId);

    const response = await put(`/api/templates/${template.id}`, {
      body: { name: "Updated Template" },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("Updated Template");
  });

  test("returns 404 for nonexistent template", async () => {
    const response = await put("/api/templates/nonexistent_id_12345", {
      body: { name: "X" },
    });
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/templates/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/templates/[id]", () => {
  test("deletes template and returns 204", async () => {
    const template = await setupTestTemplate(projectId);

    const response = await del(`/api/templates/${template.id}`);
    expect(response.status).toBe(204);
  });

  test("returns 404 for nonexistent template", async () => {
    const response = await del("/api/templates/nonexistent_id_12345");
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/[id]/preview
// ---------------------------------------------------------------------------

describe("POST /api/templates/[id]/preview", () => {
  test("renders preview with variables", async () => {
    const template = await setupTestTemplate(projectId, {
      subject: "Welcome to {{app_name}}",
      body_markdown: "# Hello, {{name}}!\n\nWelcome aboard.",
      variables: [
        { name: "app_name", type: "string", required: true },
        { name: "name", type: "string", required: true },
      ],
    });

    const response = await post(`/api/templates/${template.id}/preview`, {
      body: { variables: { app_name: "MyApp", name: "Alice" } },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ subject: string; html: string }>(response);
    expect(body.subject).toContain("MyApp");
    expect(body.html).toContain("Alice");
  });

  test("returns 404 for nonexistent template", async () => {
    const response = await post("/api/templates/nonexistent_id_12345/preview", {
      body: { variables: {} },
    });
    expect(response.status).toBe(404);
  });

  test("returns 422 for missing required variables", async () => {
    const template = await setupTestTemplate(projectId, {
      variables: [
        { name: "app_name", type: "string", required: true },
        { name: "name", type: "string", required: true },
      ],
    });

    const response = await post(`/api/templates/${template.id}/preview`, {
      body: { variables: {} },
    });
    expect(response.status).toBe(422);
  });
});
