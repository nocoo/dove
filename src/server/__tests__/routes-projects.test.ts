import { describe, test, expect, vi } from "vitest";
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
  sqlSeen?: string[];
  bindsSeen?: unknown[][];
} = {}) {
  const { allResults = [], firstResult = null, sqlSeen, bindsSeen } = opts;
  return {
    prepare: vi.fn((sql: string) => {
      sqlSeen?.push(sql);
      return {
      bind: vi.fn((...args: unknown[]) => {
        bindsSeen?.push(args);
        return {
        all: vi.fn(() => Promise.resolve({ results: allResults })),
        first: vi.fn(() => Promise.resolve(firstResult)),
        run: vi.fn(() => Promise.resolve(createMockResult())),
        };
      }),
      };
    }),
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
      // Defense-in-depth: token VALUE must never appear in list either.
      expect(JSON.stringify(body)).not.toContain("tok_secret_48chars");
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
      // Pin the OTHER input fields too (echoed back into the response)
      // — a regression that returned only {name, id, webhook_token}
      // (e.g. picking a partial response shape) would silently break
      // dashboards that immediately render the new project's email_prefix
      // and from_name in the project list. Also pin server-set defaults
      // for quotas (a regression returning undefined would crash the
      // dashboard's quota-bar UI).
      expect(body.email_prefix).toBe("hello");
      expect(body.from_name).toBe("Test Sender");
      expect(typeof body.quota_daily).toBe("number");
      expect(typeof body.quota_monthly).toBe("number");
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid input/i);
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid input/i);
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
      // Defense-in-depth: assert the raw token VALUE never appears
      // anywhere in the serialized response (catches a regression that
      // renamed the field but still leaked the secret, or stuck the
      // token into description/from_name etc).
      expect(JSON.stringify(body)).not.toContain("tok_secret_48chars");
      // Pin the rest of the documented sanitized shape — a regression
      // returning only {id} would silently break dashboard project
      // detail pages and the quota-bar UI.
      expect(body.name).toBe("Acme");
      expect(body.email_prefix).toBe("noreply");
      expect(body.from_name).toBe("Acme Inc");
      expect(body.quota_daily).toBe(100);
      expect(body.quota_monthly).toBe(1000);
    });

    test("returns 404 for missing project", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/nonexistent");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Project not found");
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
      // Defense-in-depth: token value MUST NOT appear anywhere
      // (catches renamed-field regression on PUT path too).
      expect(JSON.stringify(body)).not.toContain("tok_secret_48chars");
      // Pin id + remaining sanitized fields — a regression returning
      // {name:'Updated'} alone would silently break dashboard refresh.
      expect(body.id).toBe("proj_001");
      expect(body.email_prefix).toBeDefined();
      expect(body.from_name).toBeDefined();
      expect(typeof body.quota_daily).toBe("number");
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Project not found");
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid input/i);
    });
  });

  describe("DELETE /:id", () => {
    test("returns 204 on success AND issues DELETE SQL with bound id (silent-no-op defense)", async () => {
      const sqlSeen: string[] = [];
      const bindsSeen: unknown[][] = [];
      const db = createMockDB({ firstResult: sampleProject, sqlSeen, bindsSeen });
      const { req } = createApp(db);
      const res = await req("/proj_001", { method: "DELETE" });
      expect(res.status).toBe(204);
      const text = await res.text();
      expect(text).toBe("");
      // Defends silent-no-op: HIGHEST-STAKES — a regression that
      // returned 204 without DELETE FROM projects would leave the
      // project (with all its templates, recipients, send_logs)
      // in DB while clients believed it was wiped. Cascading GDPR
      // compliance failure for personal-data deletion requests.
      const deleteSqls = sqlSeen.filter((s) => /DELETE\s+FROM\s+projects/i.test(s));
      expect(deleteSqls.length).toBeGreaterThanOrEqual(1);
      expect(deleteSqls[0]).toMatch(/WHERE\s+id\s*=\s*\?/i);
      const deleteBind = bindsSeen.find((b) => b[0] === "proj_001");
      expect(deleteBind).toBeDefined();
    });

    test("returns 404 when not found", async () => {
      const db = createMockDB({ firstResult: null });
      const { req } = createApp(db);
      const res = await req("/missing", { method: "DELETE" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Project not found");
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Project not found");
    });
  });
});
