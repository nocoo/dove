/**
 * E2E: Templates API — GET/POST /api/templates, GET/PUT/DELETE /api/templates/[id],
 *       POST /api/templates/[id]/preview
 *
 * Mocks only D1 client; template logic + rendering runs for real.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import {
  buildNextRequest,
  buildRequest,
  parseJson,
  routeParams,
  makeTemplate,
  getD1Handler,
  setD1Handler,
  resetD1Handler,
} from "./helpers";

// Mock D1 at the boundary
mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

const template = makeTemplate();

beforeEach(() => {
  resetD1Handler();
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe("GET /api/templates", () => {
  test("returns all templates when no projectId", async () => {
    setD1Handler((sql) => {
      if (sql.includes("FROM templates")) return [template];
      return [];
    });

    const { GET } = await import("@/app/api/templates/route");
    const request = buildNextRequest("/api/templates");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("filters by projectId", async () => {
    setD1Handler((sql) => {
      if (sql.includes("project_id")) return [template];
      return [];
    });

    const { GET } = await import("@/app/api/templates/route");
    const request = buildNextRequest("/api/templates", {
      searchParams: { projectId: template.project_id },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates
// ---------------------------------------------------------------------------

describe("POST /api/templates", () => {
  test("creates template with valid input", async () => {
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/templates/route");
    const request = buildRequest("/api/templates", {
      method: "POST",
      body: {
        project_id: "proj_e2e_test123456ab",
        name: "New Template",
        slug: "new-template",
        subject: "Hello {{name}}",
        body_markdown: "# Hi\n\nWelcome.",
        variables: [{ name: "name", type: "string", required: true }],
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.slug).toBe("new-template");
  });

  test("rejects invalid slug (uppercase, spaces)", async () => {
    const { POST } = await import("@/app/api/templates/route");
    const request = buildRequest("/api/templates", {
      method: "POST",
      body: {
        project_id: "proj_123",
        name: "Bad Slug",
        slug: "Has Spaces!",
        subject: "Sub",
        body_markdown: "Body",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test("returns 409 on duplicate slug", async () => {
    setD1Handler(() => { throw new Error("UNIQUE constraint failed"); });

    const { POST } = await import("@/app/api/templates/route");
    const request = buildRequest("/api/templates", {
      method: "POST",
      body: {
        project_id: "proj_e2e_test123456ab",
        name: "Dup",
        slug: "welcome",
        subject: "Sub",
        body_markdown: "Body",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/[id]
// ---------------------------------------------------------------------------

describe("GET /api/templates/[id]", () => {
  test("returns template when found", async () => {
    setD1Handler(() => [template]);

    const { GET } = await import("@/app/api/templates/[id]/route");
    const response = await GET(
      buildRequest(`/api/templates/${template.id}`),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.id).toBe(template.id);
    expect(body.slug).toBe("welcome");
  });

  test("returns 404 when not found", async () => {
    setD1Handler(() => []);

    const { GET } = await import("@/app/api/templates/[id]/route");
    const response = await GET(
      buildRequest("/api/templates/nonexistent"),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/templates/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/templates/[id]", () => {
  test("updates template", async () => {
    let callCount = 0;
    setD1Handler((sql) => {
      callCount++;
      if (sql.includes("WHERE id = ?")) return [{ ...template, name: callCount > 1 ? "Updated" : template.name }];
      return [];
    });

    const { PUT } = await import("@/app/api/templates/[id]/route");
    const response = await PUT(
      buildRequest(`/api/templates/${template.id}`, {
        method: "PUT",
        body: { name: "Updated" },
      }),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(200);
  });

  test("returns 404 for nonexistent template", async () => {
    setD1Handler(() => []);

    const { PUT } = await import("@/app/api/templates/[id]/route");
    const response = await PUT(
      buildRequest("/api/templates/nonexistent", {
        method: "PUT",
        body: { name: "X" },
      }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/templates/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/templates/[id]", () => {
  test("deletes template and returns 204", async () => {
    setD1Handler(() => [template]);

    const { DELETE } = await import("@/app/api/templates/[id]/route");
    const response = await DELETE(
      buildRequest(`/api/templates/${template.id}`, { method: "DELETE" }),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(204);
  });

  test("returns 404 for nonexistent template", async () => {
    setD1Handler(() => []);

    const { DELETE } = await import("@/app/api/templates/[id]/route");
    const response = await DELETE(
      buildRequest("/api/templates/nonexistent", { method: "DELETE" }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/[id]/preview
// ---------------------------------------------------------------------------

describe("POST /api/templates/[id]/preview", () => {
  test("renders preview with variables", async () => {
    setD1Handler(() => [template]);

    const { POST } = await import("@/app/api/templates/[id]/preview/route");
    const response = await POST(
      buildRequest(`/api/templates/${template.id}/preview`, {
        method: "POST",
        body: {
          variables: { app_name: "MyApp", name: "Alice" },
        },
      }),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ subject: string; html: string }>(response);
    expect(body.subject).toContain("MyApp");
    expect(body.html).toContain("Alice");
  });

  test("returns 404 for nonexistent template", async () => {
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/templates/[id]/preview/route");
    const response = await POST(
      buildRequest("/api/templates/nonexistent/preview", {
        method: "POST",
        body: { variables: {} },
      }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });

  test("returns 422 for missing required variables", async () => {
    setD1Handler(() => [template]);

    const { POST } = await import("@/app/api/templates/[id]/preview/route");
    const response = await POST(
      buildRequest(`/api/templates/${template.id}/preview`, {
        method: "POST",
        body: {
          variables: {}, // missing required app_name and name
        },
      }),
      routeParams({ id: template.id }),
    );

    expect(response.status).toBe(422);
  });
});
