/**
 * E2E: Recipients API — GET/POST /api/recipients, PUT/DELETE /api/recipients/[id]
 *
 * Mocks only D1 client; all recipient logic runs for real.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import {
  buildNextRequest,
  buildRequest,
  parseJson,
  routeParams,
  makeRecipient,
  getD1Handler,
  setD1Handler,
  resetD1Handler,
} from "./helpers";

// Mock D1 at the boundary
mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

const recipient = makeRecipient();

beforeEach(() => {
  resetD1Handler();
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// GET /api/recipients
// ---------------------------------------------------------------------------

describe("GET /api/recipients", () => {
  test("returns recipients for a project", async () => {
    setD1Handler((sql) => {
      if (sql.includes("FROM recipients") && sql.includes("project_id")) return [recipient];
      return [];
    });

    const { GET } = await import("@/app/api/recipients/route");
    const request = buildNextRequest("/api/recipients", {
      searchParams: { projectId: recipient.project_id },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("returns 400 when projectId is missing", async () => {
    const { GET } = await import("@/app/api/recipients/route");
    const request = buildNextRequest("/api/recipients");

    const response = await GET(request);
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipients
// ---------------------------------------------------------------------------

describe("POST /api/recipients", () => {
  test("creates recipient with valid input", async () => {
    setD1Handler(() => []);

    const { POST } = await import("@/app/api/recipients/route");
    const request = buildRequest("/api/recipients", {
      method: "POST",
      body: {
        project_id: "proj_e2e_test123456ab",
        name: "New User",
        email: "new@example.com",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("New User");
    expect(body.email).toBe("new@example.com");
  });

  test("rejects invalid email", async () => {
    const { POST } = await import("@/app/api/recipients/route");
    const request = buildRequest("/api/recipients", {
      method: "POST",
      body: {
        project_id: "proj_123",
        name: "User",
        email: "not-an-email",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test("returns 409 on duplicate email", async () => {
    setD1Handler(() => { throw new Error("UNIQUE constraint failed"); });

    const { POST } = await import("@/app/api/recipients/route");
    const request = buildRequest("/api/recipients", {
      method: "POST",
      body: {
        project_id: "proj_e2e_test123456ab",
        name: "Dup User",
        email: "dup@example.com",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/recipients/[id]
// ---------------------------------------------------------------------------

describe("PUT /api/recipients/[id]", () => {
  test("updates recipient name", async () => {
    let callCount = 0;
    setD1Handler((sql) => {
      callCount++;
      if (sql.includes("WHERE id = ?")) return [{ ...recipient, name: callCount > 1 ? "Updated" : recipient.name }];
      return [];
    });

    const { PUT } = await import("@/app/api/recipients/[id]/route");
    const response = await PUT(
      buildRequest(`/api/recipients/${recipient.id}`, {
        method: "PUT",
        body: { name: "Updated" },
      }),
      routeParams({ id: recipient.id }),
    );

    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body.name).toBe("Updated");
  });

  test("returns 404 for nonexistent recipient", async () => {
    setD1Handler(() => []);

    const { PUT } = await import("@/app/api/recipients/[id]/route");
    const response = await PUT(
      buildRequest("/api/recipients/nonexistent", {
        method: "PUT",
        body: { name: "X" },
      }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/recipients/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/recipients/[id]", () => {
  test("deletes recipient and returns 204", async () => {
    setD1Handler((sql) => {
      if (sql.includes("WHERE id = ?")) return [recipient];
      return [];
    });

    const { DELETE } = await import("@/app/api/recipients/[id]/route");
    const response = await DELETE(
      buildRequest(`/api/recipients/${recipient.id}`, { method: "DELETE" }),
      routeParams({ id: recipient.id }),
    );

    expect(response.status).toBe(204);
  });

  test("returns 404 for nonexistent recipient", async () => {
    setD1Handler(() => []);

    const { DELETE } = await import("@/app/api/recipients/[id]/route");
    const response = await DELETE(
      buildRequest("/api/recipients/nonexistent", { method: "DELETE" }),
      routeParams({ id: "nonexistent" }),
    );

    expect(response.status).toBe(404);
  });
});
