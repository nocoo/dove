/**
 * E2E: Projects API — full CRUD + token regeneration.
 *
 * Mocks only D1 client; all project business logic runs for real.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import {
  buildNextRequest,
  buildRequest,
  parseJson,
  routeParams,
  makeProject,
  getD1Handler,
  setD1Handler,
  resetD1Handler,
} from "./helpers";

// Mock D1 at the boundary
mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

const project = makeProject();

beforeEach(() => {
  resetD1Handler();
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  test("returns project list (webhook_token stripped)", async () => {
    setD1Handler((sql) => {
      if (sql.includes("SELECT * FROM projects")) return [project];
      return [];
    });

    const { GET } = await import("@/app/api/projects/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>[]>(response);
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(project.id);
    expect(body[0]!.webhook_token).toBeUndefined();
  });

  test("returns empty array when no projects exist", async () => {
    setD1Handler(() => []);

    const { GET } = await import("@/app/api/projects/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

describe("POST /api/projects", () => {
  test("creates project with valid input and returns token", async () => {
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/projects/route");
    const request = buildRequest("/api/projects", {
      method: "POST",
      body: {
        name: "New Project",
        email_prefix: "hello",
        from_name: "Hello App",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("New Project");
    expect(body.webhook_token).toBeDefined();
    expect(typeof body.webhook_token).toBe("string");
    expect((body.webhook_token as string).length).toBe(48);
  });

  test("rejects request with missing required fields", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const request = buildRequest("/api/projects", {
      method: "POST",
      body: { email_prefix: "x" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await parseJson<{ error: string }>(response);
    expect(body.error).toBe("Invalid input");
  });

  test("rejects empty name", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const request = buildRequest("/api/projects", {
      method: "POST",
      body: { name: "", email_prefix: "x", from_name: "App" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/[id]
// ---------------------------------------------------------------------------

describe("GET /api/projects/[id]", () => {
  test("returns sanitized project when found", async () => {
    setD1Handler((sql) => {
      if (sql.includes("WHERE id = ?")) return [project];
      return [];
    });

    const { GET } = await import("@/app/api/projects/[id]/route");
    const response = await GET(
      buildRequest(`/api/projects/${project.id}`),
      routeParams({ id: project.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.id).toBe(project.id);
    expect(body.webhook_token).toBeUndefined();
  });

  test("returns 404 when project not found", async () => {
    setD1Handler(() => []);

    const { GET } = await import("@/app/api/projects/[id]/route");
    const response = await GET(
      buildRequest("/api/projects/nonexistent"),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/projects/[id]", () => {
  test("updates project with valid input", async () => {
    let callCount = 0;
    setD1Handler((sql) => {
      callCount++;
      // First call: getProject (existence check), second: UPDATE, third: getProject (return)
      if (sql.includes("WHERE id = ?")) return [{ ...project, name: callCount > 1 ? "Updated" : project.name }];
      return [];
    });

    const { PUT } = await import("@/app/api/projects/[id]/route");
    const response = await PUT(
      buildRequest(`/api/projects/${project.id}`, {
        method: "PUT",
        body: { name: "Updated" },
      }),
      routeParams({ id: project.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.webhook_token).toBeUndefined(); // sanitized
  });

  test("returns 404 for nonexistent project", async () => {
    setD1Handler(() => []);

    const { PUT } = await import("@/app/api/projects/[id]/route");
    const response = await PUT(
      buildRequest("/api/projects/nonexistent", {
        method: "PUT",
        body: { name: "X" },
      }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });

  test("rejects invalid input", async () => {
    const { PUT } = await import("@/app/api/projects/[id]/route");
    const response = await PUT(
      buildRequest(`/api/projects/${project.id}`, {
        method: "PUT",
        body: { name: "" },
      }),
      routeParams({ id: project.id }),
    );

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/projects/[id]", () => {
  test("deletes project and returns 204", async () => {
    setD1Handler((sql) => {
      if (sql.includes("WHERE id = ?")) return [project];
      return [];
    });

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const response = await DELETE(
      buildRequest(`/api/projects/${project.id}`, { method: "DELETE" }),
      routeParams({ id: project.id }),
    );

    expect(response.status).toBe(204);
  });

  test("returns 404 for nonexistent project", async () => {
    setD1Handler(() => []);

    const { DELETE } = await import("@/app/api/projects/[id]/route");
    const response = await DELETE(
      buildRequest("/api/projects/nonexistent", { method: "DELETE" }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/token
// ---------------------------------------------------------------------------

describe("POST /api/projects/[id]/token", () => {
  test("regenerates and returns new token", async () => {
    setD1Handler((sql) => {
      if (sql.includes("WHERE id = ?")) return [project];
      return [];
    });

    const { POST } = await import("@/app/api/projects/[id]/token/route");
    const response = await POST(
      buildRequest(`/api/projects/${project.id}/token`, { method: "POST" }),
      routeParams({ id: project.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ webhook_token: string }>(response);
    expect(body.webhook_token).toBeDefined();
    expect(body.webhook_token.length).toBe(48);
  });

  test("returns 404 for nonexistent project", async () => {
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/projects/[id]/token/route");
    const response = await POST(
      buildRequest("/api/projects/nonexistent/token", { method: "POST" }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});
