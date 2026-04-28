import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { authBearer } from "../middleware/auth-bearer";
import type { Project } from "../lib/db/projects";

const testProject: Project = {
  id: "proj_123",
  name: "Test Project",
  description: null,
  email_prefix: "noreply",
  from_name: "Test",
  webhook_token: "secret-token-abc",
  quota_daily: 100,
  quota_monthly: 1000,
  provider_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function createApp(projects: Project[] = [testProject]) {
  type AppEnv = { Bindings: Env; Variables: { project: Project } };
  const app = new Hono<AppEnv>();

  const mockDb = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prepare: (_sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          const id = params[0] as string;
          return projects.find((p) => p.id === id) ?? null;
        },
      }),
    }),
  };

  app.use("/api/webhook/:projectId/*", authBearer);
  app.post("/api/webhook/:projectId/send", (c) => {
    const project = c.get("project");
    return c.json({ projectId: project.id, name: project.name });
  });
  app.get("/api/webhook/:projectId/templates", (c) => {
    const project = c.get("project");
    return c.json({ projectId: project.id });
  });

  return {
    fetch: (req: Request) =>
      app.fetch(req, { DB: mockDb as unknown as D1Database } as Env),
  };
}

describe("authBearer middleware", () => {
  test("returns 401 without Authorization header", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_123/send", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("auth_missing");
  });

  test("returns 401 with non-Bearer auth", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_123/send", {
        method: "POST",
        headers: { authorization: "Basic abc" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 404 for unknown project", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/nonexistent/send", {
        method: "POST",
        headers: { authorization: "Bearer secret-token-abc" },
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("project_not_found");
  });

  test("returns 403 when token doesn't match project", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_123/send", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("auth_invalid");
  });

  test("prevents cross-project token replay", async () => {
    const projectA: Project = { ...testProject, id: "proj_A", webhook_token: "token-A" };
    const projectB: Project = { ...testProject, id: "proj_B", webhook_token: "token-B" };
    const app = createApp([projectA, projectB]);

    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_B/send", {
        method: "POST",
        headers: { authorization: "Bearer token-A" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("passes with correct projectId and token", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_123/send", {
        method: "POST",
        headers: { authorization: "Bearer secret-token-abc" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectId: string; name: string };
    expect(body.projectId).toBe("proj_123");
    expect(body.name).toBe("Test Project");
  });

  test("works on GET routes too", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj_123/templates", {
        headers: { authorization: "Bearer secret-token-abc" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectId: string };
    expect(body.projectId).toBe("proj_123");
  });
});
