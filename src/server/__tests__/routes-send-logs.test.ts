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

function createMockDBWithCapture(allResults: unknown[] = []) {
  const sqlCalls: string[] = [];
  const bindCalls: unknown[][] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      sqlCalls.push(sql);
      return {
        bind: vi.fn((...params: unknown[]) => {
          bindCalls.push(params);
          return {
            all: vi.fn(() => Promise.resolve({ results: allResults })),
            first: vi.fn(() => Promise.resolve(null)),
            run: vi.fn(() => Promise.resolve({ success: true })),
          };
        }),
      };
    }),
  } as unknown as D1Database;
  return { db, sqlCalls, bindCalls };
}

describe("send-logs route handlers", () => {
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
    // Critical: the filter value MUST be bound to the SELECT — a regression
    // that drops the filter would silently return all sends across projects
    // (cross-tenant data leak).
    expect(bindCalls.flat()).toContain("proj_001");
  });

  test("GET /?status= filters by status (pin status bind position [0])", async () => {
    const { db, bindCalls, sqlCalls } = createMockDBWithCapture([]);
    const { req } = createApp(db);
    const res = await req("/?status=failed");
    expect(res.status).toBe(200);
    // Pin position: route uses listAllSendLogs status branch with binds
    // [status, limit, offset]. A regression that put 'failed' into the
    // limit slot (e.g. arg-order swap) would silently pass toContain.
    const sendLogsCall = sqlCalls.findIndex((s) => /FROM send_logs/i.test(s));
    expect(sendLogsCall).toBeGreaterThanOrEqual(0);
    const binds = bindCalls[sendLogsCall] as unknown[];
    expect(binds[0]).toBe("failed");
  });

  test("GET / with pagination params (pin LIMIT/OFFSET bind positions)", async () => {
    const { db, bindCalls, sqlCalls } = createMockDBWithCapture([]);
    const { req } = createApp(db);
    const res = await req("/?limit=10&offset=20");
    expect(res.status).toBe(200);
    // Pagination must be respected: regression that ignored params would
    // accidentally return all rows (DOS the API on large tables).
    // Pre-strengthening, only `flat.toContain(10)` + `toContain(20)` was
    // checked — a limit↔offset swap (limit=20, offset=10) silently
    // passes both. Pin positions: route binds [limit, offset] for the
    // no-projectId / no-status branch.
    const sendLogsCall = sqlCalls.findIndex((s) => /FROM send_logs/i.test(s));
    expect(sendLogsCall).toBeGreaterThanOrEqual(0);
    const binds = bindCalls[sendLogsCall] as unknown[];
    expect(binds[0]).toBe(10); // LIMIT (NOT offset)
    expect(binds[1]).toBe(20); // OFFSET (NOT limit)
  });
});
