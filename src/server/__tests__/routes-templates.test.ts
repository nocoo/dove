import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { templates } from "../routes/templates";

const sampleTemplate = {
  id: "tpl_001",
  project_id: "proj_001",
  name: "Welcome",
  slug: "welcome",
  subject: "Hello {{name}}",
  body_markdown: "Hi **{{name}}**!",
  variables: JSON.stringify([{ name: "name", type: "string", required: true }]),
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

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
        run: mock(() => Promise.resolve({ success: true, meta: {}, results: [] })),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", templates);
  return {
    req: (path: string, init?: RequestInit) =>
      app.request(path, init, { DB: db } as unknown as Env),
  };
}

describe("templates route handlers", () => {
  test("GET / returns all templates", async () => {
    const { req } = createApp(createMockDB({ allResults: [sampleTemplate] }));
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  test("GET /?projectId= filters by project", async () => {
    const { req } = createApp(createMockDB({ allResults: [sampleTemplate] }));
    const res = await req("/?projectId=proj_001");
    expect(res.status).toBe(200);
  });

  test("POST / creates template 201", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "p1",
        name: "New",
        slug: "new-template",
        subject: "Hi",
        body_markdown: "Hello",
      }),
    });
    expect(res.status).toBe(201);
  });

  test("POST / returns 400 for invalid slug", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "p1",
        name: "New",
        slug: "INVALID SLUG",
        subject: "Hi",
        body_markdown: "Hello",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /:id returns template", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
    const res = await req("/tpl_001");
    expect(res.status).toBe(200);
  });

  test("GET /:id returns 404 when not found", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/missing");
    expect(res.status).toBe(404);
  });

  test("PUT /:id updates template", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
    const res = await req("/tpl_001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Updated");
  });

  test("DELETE /:id returns 204", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
    const res = await req("/tpl_001", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("POST /:id/preview returns 404 for missing template", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/missing/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test("POST /:id/preview renders template", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
    const res = await req("/tpl_001/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: { name: "Alice" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: string; html: string };
    expect(body.subject).toBe("Hello Alice");
    expect(body.html).toContain("Alice");
  });
});
