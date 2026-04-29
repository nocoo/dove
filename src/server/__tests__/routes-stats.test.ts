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

  test("GET / aggregates daily/monthly sends across multiple projects", async () => {
    // The empty-projects test exercised only the early-exit. This test
    // covers the for-loop body (the actual aggregation) — a regression
    // that swapped += for = (or skipped the loop) would silently report
    // wrong totals on a working dashboard.
    const projects = [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
      { id: "p3", name: "P3" },
    ];
    // Distinct counts per query type pin attribution: a regression that
    // swapped countDailySends ↔ countMonthlySends in the destructure
    // would produce 21 daily + 15 monthly instead of 15 daily + 21
    // monthly — misleading the operator's quota dashboard. Identical
    // mock counts would have hidden this entirely.
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          all: vi.fn(() => {
            // The failed-today query uses `query<{count}>` (calls .all),
            // so route the failed branch through .all() too.
            if (/status\s*=\s*'failed'/i.test(sql))
              return Promise.resolve({ results: [{ count: 3 }] });
            return Promise.resolve({ results: projects });
          }),
          first: vi.fn(() => {
            // countDailySends uses date('now'); countMonthlySends uses
            // strftime('%Y-%m-01', 'now') — distinguishable by SQL.
            if (/strftime\('%Y-%m-01'/i.test(sql)) return Promise.resolve({ count: 7 });
            if (/date\('now'\)/i.test(sql) && /status\s*=\s*'sent'/i.test(sql))
              return Promise.resolve({ count: 5 });
            return Promise.resolve({ count: 0 });
          }),
          run: vi.fn(() => Promise.resolve({ success: true })),
        })),
      })),
    } as unknown as D1Database;
    const { req } = createApp(db);
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_projects: number;
      total_sends_today: number;
      total_sends_month: number;
      total_failed_today: number;
    };
    expect(body.total_projects).toBe(3);
    // 3 projects × 5 daily = 15; 3 projects × 7 monthly = 21. Swap of
    // the destructure caught (swap would yield 21 today + 15 month).
    expect(body.total_sends_today).toBe(15);
    expect(body.total_sends_month).toBe(21);
    // total_failed_today is a SEPARATE query (not in the per-project
    // for-loop). Pin it with a distinct value so a regression that:
    //  (a) read the wrong column (e.g. SUM instead of COUNT) yields 0;
    //  (b) routed sent count into failed yields 5;
    //  (c) routed monthly count into failed yields 7;
    // would all be caught.
    expect(body.total_failed_today).toBe(3);
    // Pin the failed-today SQL window: must be `date('now')`-bounded
    // (today only). A regression that dropped the date filter would
    // silently inflate this counter to ALL-TIME failures — dashboard
    // would scream red on a healthy day. Mock returns 3 regardless of
    // SQL, so without this pin the regression is invisible.
    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    const failedSql = prepareMock.mock.calls
      .map((c) => c[0] as string)
      .find((s) => /status\s*=\s*'failed'/i.test(s));
    expect(failedSql).toBeDefined();
    expect(failedSql!).toMatch(/created_at\s*>=\s*date\s*\(\s*'now'\s*\)/i);
    expect(failedSql!).toMatch(/created_at\s*<\s*date\s*\(\s*'now'\s*,\s*'\+1 day'/i);
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
    // Pin the SQL window contract: BOTH sent and failed queries must
    // pull `-30 days` to align with the JS-built 30-entry timeline
    // (lines 65-77). A regression to `-7 days` (or `-90 days`) would
    // be SILENT here — body.length is built from the JS loop, not the
    // SQL row count, so the chart would show flat zeros for missing
    // days OR clipped recent data without any test failure. Two queries
    // (sent + failed) so two SQL strings should each reference -30 days.
    const prepareMock = (db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
    const sqls = prepareMock.mock.calls.map((c) => c[0] as string);
    const dateBoundedSqls = sqls.filter((s) => /sent_at|created_at/i.test(s) && /date\s*\(/i.test(s));
    expect(dateBoundedSqls.length).toBeGreaterThanOrEqual(2);
    for (const s of dateBoundedSqls) expect(s).toMatch(/-30\s*days/i);
  });

  test("GET /charts merges sent/failed counts onto matching date entries", async () => {
    // Covers the previously-uncovered Map-builder callbacks (`(r) => [r.date,
    // r.count]`) AND the date-merge logic at lines 70-72. Without this,
    // a regression that swapped sentMap/failedMap or dropped the lookup
    // would silently render flat-zero charts ("no activity") even when
    // the DB returned data — catastrophic for a dashboard.
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    // Two DIFFERENT counts so a regression that SWAPS sentMap/failedMap
    // would flip the values in the response (sent=11, failed=7) and
    // fail this test — a bug class identical-mock-rows would hide.
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          all: vi.fn(() => {
            if (/status\s*=\s*'sent'/i.test(sql)) {
              return Promise.resolve({ results: [{ date: todayStr, count: 7 }] });
            }
            if (/status\s*=\s*'failed'/i.test(sql)) {
              return Promise.resolve({ results: [{ date: todayStr, count: 11 }] });
            }
            return Promise.resolve({ results: [] });
          }),
          first: vi.fn(() => Promise.resolve(null)),
          run: vi.fn(() => Promise.resolve({ success: true })),
        })),
      })),
    } as unknown as D1Database;
    const { req } = createApp(db);
    const res = await req("/charts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; sent: number; failed: number }[];
    expect(body).toHaveLength(30);
    const todayEntry = body.find((e) => e.date === todayStr);
    expect(todayEntry).toBeDefined();
    // Distinct values pin attribution: sent→11 (or any swap) caught.
    expect(todayEntry?.sent).toBe(7);
    expect(todayEntry?.failed).toBe(11);
    const otherDay = body.find((e) => e.date !== todayStr);
    expect(otherDay?.sent).toBe(0);
    expect(otherDay?.failed).toBe(0);
  });
});
