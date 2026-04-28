import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { stats } from "../routes/stats";

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
        run: vi.fn(() => Promise.resolve({ success: true })),
      })),
    })),
  } as unknown as D1Database;
}

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", stats);
  return {
    req: (path: string) => app.request(path, {}, { DB: db } as unknown as Env),
  };
}

describe("stats route handlers", () => {
  test("GET / returns dashboard stats", async () => {
    const db = createMockDB({ allResults: [], firstResult: { count: 0 } });
    const { req } = createApp(db);
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_projects: number;
      total_sends_today: number;
      total_sends_month: number;
      total_failed_today: number;
    };
    expect(body.total_projects).toBe(0);
    expect(body.total_sends_today).toBe(0);
    expect(body.total_sends_month).toBe(0);
    expect(body.total_failed_today).toBe(0);
  });

  test("GET /charts returns 30-day chart data", async () => {
    const db = createMockDB({ allResults: [] });
    const { req } = createApp(db);
    const res = await req("/charts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; sent: number; failed: number }[];
    expect(body).toHaveLength(30);
    expect(body[0]).toHaveProperty("date");
    expect(body[0]).toHaveProperty("sent");
    expect(body[0]).toHaveProperty("failed");
  });
});
