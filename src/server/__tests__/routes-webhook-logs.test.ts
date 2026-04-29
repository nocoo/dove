import { describe, test, expect, vi } from "vitest";
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
  app.route("/", webhookLogs);
  return {
    req: (path: string) => app.request(path, {}, { DB: db } as unknown as Env),
  };
}

function createMockDBWithCapture(allResults: unknown[] = []) {
  const bindCalls: unknown[][] = [];
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn((...params: unknown[]) => {
        bindCalls.push(params);
        return {
          all: vi.fn(() => Promise.resolve({ results: allResults })),
          first: vi.fn(() => Promise.resolve(null)),
          run: vi.fn(() => Promise.resolve({ success: true })),
        };
      }),
    })),
  } as unknown as D1Database;
  return { db, bindCalls };
}

describe("webhook-logs route handlers", () => {
  test("GET / returns all logs", async () => {
    const { req } = createApp(createMockDB([sampleLog]));
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  test("GET /?projectId= filters by project (binds projectId)", async () => {
    const { db, bindCalls } = createMockDBWithCapture([sampleLog]);
    const { req } = createApp(db);
    const res = await req("/?projectId=proj_001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    // Tenancy guard: filter MUST be passed to the SELECT — a regression
    // dropping it would return webhook logs across all projects (leak
    // sender domains, recipient counts, error patterns).
    expect(bindCalls.flat()).toContain("proj_001");
  });

  test("GET / with pagination params (pin LIMIT/OFFSET bind positions)", async () => {
    const { db, bindCalls } = createMockDBWithCapture([]);
    const { req } = createApp(db);
    const res = await req("/?limit=10&offset=5");
    expect(res.status).toBe(200);
    // limit↔offset swap silently passes toContain() since both numbers
    // are present — just at swapped positions. Pin positions: route
    // binds [limit, offset] for the no-projectId branch.
    const binds = bindCalls[0] as unknown[];
    expect(binds[0]).toBe(10); // LIMIT
    expect(binds[1]).toBe(5);  // OFFSET
  });
});
