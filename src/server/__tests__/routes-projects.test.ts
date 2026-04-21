import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { projects } from "../routes/projects";
import type { Project } from "../lib/db/projects";

const sampleProject: Project = {
  id: "proj_001",
  name: "Acme",
  description: "Acme project",
  email_prefix: "noreply",
  from_name: "Acme Inc",
  webhook_token: "tok_secret_48chars_xxxxxxxxxxxxxxxxxxxxxxxxxx",
  quota_daily: 100,
  quota_monthly: 1000,
  provider_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function createMockResult(): D1Result {
  return {
    success: true,
    meta: { duration: 1, changes: 1, last_row_id: 0, rows_read: 0, rows_written: 0, size_after: 0, changed_db: false },
    results: [],
  } as unknown as D1Result;
}

function createMockDB(opts: {
  allResults?: unknown[];
  firstResult?: unknown;
} = {}) {
  const { allResults = [], firstResult = null } = opts;
  return {
    prepare: mock(() => ({
      bind: mock(() => ({
        all: mock(() => Promise.resolve({ results: allResults })),
        first: mock(() => Promise.resolve(firstResult)),
        run: mock(() => Promise.resolve(createMockResult())),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", projects);
  return {
    req: (path: string, init?: RequestInit) =>
      app.request(path, init, { DB: db } as unknown as Env),
  };
}

describe("projects route handlers", () => {
  describe("GET /", () => {
    test("returns list without webhook_token", async () => {
      const db = createMockDB({ allResults: [sampleProject] });
      const { req } = createApp(db);
      const res = await req("/");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>[];
      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty("webhook_token");
      expect(body[0]!.id).toBe("proj_001");
    });

    test("returns empty array when no projects", async () => {
      const db = createMockDB({ allResults: [] });
      const { req } = createApp(db);
      const res = await req("/");
      expect((await res.json()) as unknown[]).toEqual([]);
    });
  });

  describe("POST /", () => {
    test("creates project and returns 201", async () => {
      const db = createMockDB();
      const { req } = createApp(db);
      const res = await req("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Project",
          email_prefix: "hello",
          from_name: "Test Sender",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Project;
      expect(body.name).toBe("New Project");
      expect(body.id).toHaveLength(21);
      expect(body.webhook_token).toHaveLength(48);
    });

    test("returns 400 for empty name", async () => {
      const db = createMockDB();
      const { req } = createApp(db);
      const res = await req("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", email_prefix: "x", from_name: "y" }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 when required fields missing", async () => {
      const db = createMockDB();
      const { req } = createApp(db);
      const res = await req("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test("accepts optional fields", async () => {
      const db = createMockDB();
      const { req } = createApp(db);
      const res = await req("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Full",
          email_prefix: "info",
          from_name: "Info",
          description: "Desc",
          quota_daily: 50,
          quota_monthly: 500,
          provider_id: null,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Project;
      expect(body.quota_daily).toBe(50);
    });
  });

  describe("GET /:id", () => {
    test("returns project without webhook_token", async () => {
      const db = createMockDB({ firstResult: sampleProject });
      const { req } = createApp(db);
      const res = await req("/proj_001");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBe("proj_001");
      expect(body).not.toHaveProperty("webhook_token");
    });

    test("returns 404 for missing project", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /:id", () => {
    test("updates and returns sanitized project", async () => {
      const db = createMockDB({ firstResult: sampleProject });
      const { req } = createApp(db);
      const res = await req("/proj_001", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("Updated");
      expect(body).not.toHaveProperty("webhook_token");
    });

    test("returns 404 when project not found", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/missing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      });
      expect(res.status).toBe(404);
    });

    test("returns 400 for invalid update", async () => {
      const db = createMockDB({ firstResult: sampleProject });
      const { req } = createApp(db);
      const res = await req("/proj_001", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /:id", () => {
    test("returns 204 on success", async () => {
      const db = createMockDB({ firstResult: sampleProject });
      const { req } = createApp(db);
      const res = await req("/proj_001", { method: "DELETE" });
      expect(res.status).toBe(204);
    });

    test("returns 404 when not found", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/missing", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/token", () => {
    test("regenerates token and returns it", async () => {
      const db = createMockDB({ firstResult: sampleProject });
      const { req } = createApp(db);
      const res = await req("/proj_001/token", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { webhook_token: string };
      expect(body.webhook_token).toHaveLength(48);
    });

    test("returns 404 when project not found", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/missing/token", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });
});
