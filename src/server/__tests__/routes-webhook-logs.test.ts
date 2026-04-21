import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { webhookLogs } from "../routes/webhook-logs";

const sampleLog = {
  id: "wl_001",
  project_id: "proj_001",
  method: "POST",
  path: "/api/webhook/proj_001/send",
  status_code: 200,
  created_at: "2026-01-01T00:00:00.000Z",
};

function createMockDB(allResults: unknown[] = []) {
  return {
    prepare: mock(() => ({
      bind: mock(() => ({
        all: mock(() => Promise.resolve({ results: allResults })),
        first: mock(() => Promise.resolve(null)),
        run: mock(() => Promise.resolve({ success: true })),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", webhookLogs);
  return {
    req: (path: string) => app.request(path, {}, { DB: db } as unknown as Env),
  };
}

describe("webhook-logs route handlers", () => {
  test("GET / returns all logs", async () => {
    const { req } = createApp(createMockDB([sampleLog]));
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  test("GET /?projectId= filters by project", async () => {
    const { req } = createApp(createMockDB([sampleLog]));
    const res = await req("/?projectId=proj_001");
    expect(res.status).toBe(200);
  });

  test("GET / with pagination params", async () => {
    const { req } = createApp(createMockDB([]));
    const res = await req("/?limit=10&offset=5");
    expect(res.status).toBe(200);
  });
});
