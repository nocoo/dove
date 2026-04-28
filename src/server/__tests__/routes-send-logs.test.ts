import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { sendLogs } from "../routes/send-logs";

const sampleLog = {
  id: "sl_001",
  project_id: "proj_001",
  to_email: "user@example.com",
  subject: "Test",
  status: "sent",
  created_at: "2026-01-01T00:00:00.000Z",
};

function createMockDB(allResults: unknown[] = []) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(() => Promise.resolve({ results: allResults })),
        first: vi.fn(() => Promise.resolve(null)),
        run: vi.fn(() => Promise.resolve({ success: true })),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", sendLogs);
  return {
    req: (path: string) => app.request(path, {}, { DB: db } as unknown as Env),
  };
}

describe("send-logs route handlers", () => {
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

  test("GET /?status= filters by status", async () => {
    const { req } = createApp(createMockDB([]));
    const res = await req("/?status=failed");
    expect(res.status).toBe(200);
  });

  test("GET / with pagination params", async () => {
    const { req } = createApp(createMockDB([]));
    const res = await req("/?limit=10&offset=20");
    expect(res.status).toBe(200);
  });
});
