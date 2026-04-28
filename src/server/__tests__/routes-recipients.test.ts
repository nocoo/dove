import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { recipients } from "../routes/recipients";

const sampleRecipient = {
  id: "rec_001",
  project_id: "proj_001",
  name: "Alice",
  email: "alice@example.com",
  created_at: "2026-01-01T00:00:00.000Z",
};

function createMockDB(opts: {
  allResults?: unknown[];
  firstResult?: unknown;
} = {}) {
  const { allResults = [], firstResult = null } = opts;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(() => Promise.resolve({ results: allResults })),
        first: vi.fn(() => Promise.resolve(firstResult)),
        run: vi.fn(() => Promise.resolve({ success: true, meta: {}, results: [] })),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recipients);
  return {
    req: (path: string, init?: RequestInit) =>
      app.request(path, init, { DB: db } as unknown as Env),
  };
}

describe("recipients route handlers", () => {
  test("GET / requires projectId", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/");
    expect(res.status).toBe(400);
  });

  test("GET /?projectId= returns list", async () => {
    const { req } = createApp(createMockDB({ allResults: [sampleRecipient] }));
    const res = await req("/?projectId=proj_001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  test("POST / creates recipient 201", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: "p1", name: "Bob", email: "bob@x.com" }),
    });
    expect(res.status).toBe(201);
  });

  test("POST / returns 400 for invalid input", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: "p1" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /:id returns 404 when not found", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/rec_999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(404);
  });

  test("PUT /:id updates recipient", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleRecipient }));
    const res = await req("/rec_001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Updated");
  });

  test("DELETE /:id returns 204 on success", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleRecipient }));
    const res = await req("/rec_001", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("DELETE /:id returns 404 when not found", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/rec_999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
