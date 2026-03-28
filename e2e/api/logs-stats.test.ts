/**
 * E2E: Logs & Stats API — GET /api/send-logs, GET /api/webhook-logs,
 *       GET /api/stats, GET /api/stats/charts
 *
 * Real HTTP against running dev server on port 17046.
 * Tests verify response shape and status codes; exact counts depend on test DB state.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  get,
  parseJson,
  setupTestProject,
  cleanupProject,
} from "./helpers";

let projectId: string;

beforeAll(async () => {
  const project = await setupTestProject();
  projectId = project.id;
});

afterAll(async () => {
  await cleanupProject(projectId);
});

// ---------------------------------------------------------------------------
// GET /api/send-logs
// ---------------------------------------------------------------------------

describe("GET /api/send-logs", () => {
  test("returns send logs array", async () => {
    const response = await get("/api/send-logs");

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(Array.isArray(body)).toBe(true);
  });

  test("filters by projectId", async () => {
    const response = await get("/api/send-logs", {
      searchParams: { projectId },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(Array.isArray(body)).toBe(true);
  });

  test("respects pagination params", async () => {
    const response = await get("/api/send-logs", {
      searchParams: { limit: "10", offset: "0" },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webhook-logs
// ---------------------------------------------------------------------------

describe("GET /api/webhook-logs", () => {
  test("returns webhook logs array", async () => {
    const response = await get("/api/webhook-logs");

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(Array.isArray(body)).toBe(true);
  });

  test("filters by projectId", async () => {
    const response = await get("/api/webhook-logs", {
      searchParams: { projectId },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------

describe("GET /api/stats", () => {
  test("returns aggregated dashboard stats", async () => {
    const response = await get("/api/stats");

    expect(response.status).toBe(200);
    const body = await parseJson<{
      total_projects: number;
      total_sends_today: number;
      total_sends_month: number;
      total_failed_today: number;
    }>(response);

    expect(typeof body.total_projects).toBe("number");
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
    const response = await get("/api/stats/charts");

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ date: string; sent: number; failed: number }>>(response);
    expect(body).toHaveLength(30);

    const first = body[0]!;
    expect(first.date).toBeDefined();
    expect(typeof first.sent).toBe("number");
    expect(typeof first.failed).toBe("number");
  });
});
