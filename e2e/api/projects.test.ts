/**
 * E2E: Projects API — full CRUD + token regeneration.
 *
 * Real HTTP against running dev server on port 17032.
 */
import { describe, expect, test, afterAll } from "bun:test";
import {
  get,
  post,
  put,
  del,
  parseJson,
  setupTestProject,
  cleanupProject,
} from "./helpers";

// Track projects created during tests for cleanup
const createdProjectIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) {
    await cleanupProject(id);
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  test("returns project list (webhook_token stripped)", async () => {
    const project = await setupTestProject();
    createdProjectIds.push(project.id);

    const response = await get("/api/projects");
    expect(response.status).toBe(200);

    const body = await parseJson<Record<string, unknown>[]>(response);
    expect(body.length).toBeGreaterThanOrEqual(1);

    // Find our test project
    const found = body.find((p) => p.id === project.id);
    expect(found).toBeDefined();
    expect(found!.webhook_token).toBeUndefined(); // sanitized in list
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

describe("POST /api/projects", () => {
  test("creates project with valid input and returns token", async () => {
    const response = await post("/api/projects", {
      body: {
        name: "E2E Create Test",
        email_prefix: "hello",
        from_name: "Hello App",
      },
    });

    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("E2E Create Test");
    expect(body.webhook_token).toBeDefined();
    expect(typeof body.webhook_token).toBe("string");
    expect((body.webhook_token as string).length).toBe(48);

    createdProjectIds.push(body.id as string);
  });

  test("rejects request with missing required fields", async () => {
    const response = await post("/api/projects", {
      body: { email_prefix: "x" },
    });
    expect(response.status).toBe(400);
    const body = await parseJson<{ error: string }>(response);
    expect(body.error).toBe("Invalid input");
  });

  test("rejects empty name", async () => {
    const response = await post("/api/projects", {
      body: { name: "", email_prefix: "x", from_name: "App" },
    });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/[id]
// ---------------------------------------------------------------------------

describe("GET /api/projects/[id]", () => {
  test("returns sanitized project when found", async () => {
    const project = await setupTestProject();
    createdProjectIds.push(project.id);

    const response = await get(`/api/projects/${project.id}`);
    expect(response.status).toBe(200);

    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.id).toBe(project.id);
    expect(body.webhook_token).toBeUndefined(); // sanitized
  });

  test("returns 404 when project not found", async () => {
    const response = await get("/api/projects/nonexistent_id_12345");
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/projects/[id]", () => {
  test("updates project with valid input", async () => {
    const project = await setupTestProject();
    createdProjectIds.push(project.id);

    const response = await put(`/api/projects/${project.id}`, {
      body: { name: "Updated E2E" },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("Updated E2E");
    expect(body.webhook_token).toBeUndefined(); // sanitized
  });

  test("returns 404 for nonexistent project", async () => {
    const response = await put("/api/projects/nonexistent_id_12345", {
      body: { name: "X" },
    });
    expect(response.status).toBe(404);
  });

  test("rejects invalid input", async () => {
    const project = await setupTestProject();
    createdProjectIds.push(project.id);

    const response = await put(`/api/projects/${project.id}`, {
      body: { name: "" },
    });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/projects/[id]", () => {
  test("deletes project and returns 204", async () => {
    const project = await setupTestProject();
    // Don't add to cleanup — we're deleting it here

    const response = await del(`/api/projects/${project.id}`);
    expect(response.status).toBe(204);

    // Verify it's gone
    const getResponse = await get(`/api/projects/${project.id}`);
    expect(getResponse.status).toBe(404);
  });

  test("returns 404 for nonexistent project", async () => {
    const response = await del("/api/projects/nonexistent_id_12345");
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/token
// ---------------------------------------------------------------------------

describe("POST /api/projects/[id]/token", () => {
  test("regenerates and returns new token", async () => {
    const project = await setupTestProject();
    createdProjectIds.push(project.id);

    const response = await post(`/api/projects/${project.id}/token`);
    expect(response.status).toBe(200);

    const body = await parseJson<{ webhook_token: string }>(response);
    expect(body.webhook_token).toBeDefined();
    expect(body.webhook_token.length).toBe(48);
    // New token should differ from original
    expect(body.webhook_token).not.toBe(project.webhook_token);
  });

  test("returns 404 for nonexistent project", async () => {
    const response = await post("/api/projects/nonexistent_id_12345/token");
    expect(response.status).toBe(404);
  });
});
