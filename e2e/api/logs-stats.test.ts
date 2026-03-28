/**
 * E2E: Logs & Stats API — GET /api/send-logs, GET /api/webhook-logs,
 *       GET /api/stats, GET /api/stats/charts
 *
 * Mocks only D1 client; all aggregation logic runs for real.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import {
  buildNextRequest,
  parseJson,
  makeProject,
  makeSendLog,
  makeWebhookLog,
  getD1Handler,
  setD1Handler,
  resetD1Handler,
} from "./helpers";

// Mock D1 at the boundary
mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

const project = makeProject();
const sendLog = makeSendLog();
const webhookLog = makeWebhookLog();

beforeEach(() => {
  resetD1Handler();
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// GET /api/send-logs
// ---------------------------------------------------------------------------

describe("GET /api/send-logs", () => {
  test("returns send logs without filter", async () => {
    setD1Handler((sql) => {
      if (sql.includes("FROM send_logs")) return [sendLog];
      return [];
    });

    const { GET } = await import("@/app/api/send-logs/route");
    const request = buildNextRequest("/api/send-logs");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("filters by projectId", async () => {
    setD1Handler((sql) => {
      if (sql.includes("project_id") && sql.includes("FROM send_logs")) return [sendLog];
      return [];
    });

    const { GET } = await import("@/app/api/send-logs/route");
    const request = buildNextRequest("/api/send-logs", {
      searchParams: { projectId: sendLog.project_id },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("respects pagination params", async () => {
    let capturedSql = "";
    setD1Handler((sql) => {
      capturedSql = sql;
      return [];
    });

    const { GET } = await import("@/app/api/send-logs/route");
    const request = buildNextRequest("/api/send-logs", {
      searchParams: { limit: "10", offset: "20" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(capturedSql).toContain("LIMIT");
  });
});

// ---------------------------------------------------------------------------
// GET /api/webhook-logs
// ---------------------------------------------------------------------------

describe("GET /api/webhook-logs", () => {
  test("returns webhook logs without filter", async () => {
    setD1Handler((sql) => {
      if (sql.includes("FROM webhook_logs")) return [webhookLog];
      return [];
    });

    const { GET } = await import("@/app/api/webhook-logs/route");
    const request = buildNextRequest("/api/webhook-logs");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("filters by projectId", async () => {
    setD1Handler((sql) => {
      if (sql.includes("project_id") && sql.includes("FROM webhook_logs")) return [webhookLog];
      return [];
    });

    const { GET } = await import("@/app/api/webhook-logs/route");
    const request = buildNextRequest("/api/webhook-logs", {
      searchParams: { projectId: webhookLog.project_id },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------

describe("GET /api/stats", () => {
  test("returns aggregated dashboard stats", async () => {
    setD1Handler((sql) => {
      if (sql.includes("FROM projects")) return [project];
      if (sql.includes("COUNT") && sql.includes("sent_at") && sql.includes("date('now')")) return [{ count: 5 }];
      if (sql.includes("COUNT") && sql.includes("sent_at") && sql.includes("start of month")) return [{ count: 42 }];
      if (sql.includes("COUNT") && sql.includes("failed")) return [{ count: 2 }];
      return [{ count: 0 }];
    });

    const { GET } = await import("@/app/api/stats/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await parseJson<{
      total_projects: number;
      total_sends_today: number;
      total_sends_month: number;
      total_failed_today: number;
    }>(response);

    expect(body.total_projects).toBe(1);
    expect(typeof body.total_sends_today).toBe("number");
    expect(typeof body.total_sends_month).toBe("number");
    expect(typeof body.total_failed_today).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// GET /api/stats/charts
// ---------------------------------------------------------------------------

describe("GET /api/stats/charts", () => {
  test("returns 30 days of chart data", async () => {
    setD1Handler(() => []);

    const { GET } = await import("@/app/api/stats/charts/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ date: string; sent: number; failed: number }>>(response);
    expect(body).toHaveLength(30);

    const first = body[0]!;
    expect(first.date).toBeDefined();
    expect(typeof first.sent).toBe("number");
    expect(typeof first.failed).toBe("number");
  });
});
