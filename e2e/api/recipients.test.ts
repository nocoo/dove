/**
 * E2E: Recipients API — GET/POST /api/recipients, PUT/DELETE /api/recipients/[id]
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
  setupTestRecipient,
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
// GET /api/recipients
// ---------------------------------------------------------------------------

describe("GET /api/recipients", () => {
  test("returns recipients for a project", async () => {
    const recipient = await setupTestRecipient(projectId);

    const response = await get("/api/recipients", {
      searchParams: { projectId },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>[]>(response);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((r) => r.id === recipient.id);
    expect(found).toBeDefined();
  });

  test("returns 400 when projectId is missing", async () => {
    const response = await get("/api/recipients");
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipients
// ---------------------------------------------------------------------------

describe("POST /api/recipients", () => {
  test("creates recipient with valid input", async () => {
    const email = `e2e-create-${Date.now()}@example.com`;
    const response = await post("/api/recipients", {
      body: {
        project_id: projectId,
        name: "New User",
        email,
      },
    });

    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("New User");
    expect(body.email).toBe(email);
  });

  test("rejects invalid email", async () => {
    const response = await post("/api/recipients", {
      body: {
        project_id: projectId,
        name: "User",
        email: "not-an-email",
      },
    });
    expect(response.status).toBe(400);
  });

  test("returns 409 on duplicate email", async () => {
    const email = `e2e-dup-${Date.now()}@example.com`;

    // Create first
    await post("/api/recipients", {
      body: { project_id: projectId, name: "First", email },
    });

    // Try duplicate
    const response = await post("/api/recipients", {
      body: { project_id: projectId, name: "Dup", email },
    });
    expect(response.status).toBe(409);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// PUT /api/recipients/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/recipients/[id]", () => {
  test("updates recipient name", async () => {
    const recipient = await setupTestRecipient(projectId);

    const response = await put(`/api/recipients/${recipient.id}`, {
      body: { name: "Updated Name" },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("Updated Name");
  });

  test("returns 404 for nonexistent recipient", async () => {
    const response = await put("/api/recipients/nonexistent_id_12345", {
      body: { name: "X" },
    });
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/recipients/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/recipients/[id]", () => {
  test("deletes recipient and returns 204", async () => {
    const recipient = await setupTestRecipient(projectId);

    const response = await del(`/api/recipients/${recipient.id}`);
    expect(response.status).toBe(204);
  });

  test("returns 404 for nonexistent recipient", async () => {
    const response = await del("/api/recipients/nonexistent_id_12345");
    expect(response.status).toBe(404);
  });
});
