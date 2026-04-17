/**
 * Route-level tests for /api/projects and /api/projects/[id] focused on
 * the provider_id pass-through added for multi-provider support.
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success } from "./helpers";
import { makeProject } from "./helpers";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

describe("POST /api/projects (provider_id)", () => {
  test("forwards provider_id to DB insert", async () => {
    let insertParams: unknown[] = [];
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        sql: string;
        params?: unknown[];
      };
      if (/INSERT INTO projects/i.test(body.sql)) {
        insertParams = body.params ?? [];
        return d1Success([]);
      }
      return d1Success([]);
    });
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(
      jsonRequest("http://x/api/projects", "POST", {
        name: "With Provider",
        email_prefix: "noreply",
        from_name: "App",
        provider_id: "prov_abc",
      }),
    );
    expect(res.status).toBe(201);
    // The INSERT binds provider_id as the 9th positional param (0-indexed 8).
    expect(insertParams[8]).toBe("prov_abc");
  });

  test("defaults provider_id to null when omitted", async () => {
    let insertParams: unknown[] = [];
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        sql: string;
        params?: unknown[];
      };
      if (/INSERT INTO projects/i.test(body.sql)) {
        insertParams = body.params ?? [];
      }
      return d1Success([]);
    });
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(
      jsonRequest("http://x/api/projects", "POST", {
        name: "Legacy",
        email_prefix: "noreply",
        from_name: "App",
      }),
    );
    expect(res.status).toBe(201);
    expect(insertParams[8]).toBeNull();
  });

  test("rejects empty-string provider_id", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(
      jsonRequest("http://x/api/projects", "POST", {
        name: "Bad",
        email_prefix: "noreply",
        from_name: "App",
        provider_id: "",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/projects/[id] (provider_id)", () => {
  test("forwards provider_id: null to unassign", async () => {
    let updateParams: unknown[] = [];
    const existing = makeProject({ provider_id: "prov_old" });
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        sql: string;
        params?: unknown[];
      };
      if (/^SELECT \* FROM projects WHERE id/i.test(body.sql)) {
        return d1Success([existing]);
      }
      if (/^UPDATE projects/i.test(body.sql)) {
        updateParams = body.params ?? [];
        return d1Success([]);
      }
      return d1Success([]);
    });
    const { PUT } = await import("@/app/api/projects/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/projects/proj_1", "PUT", {
        provider_id: null,
      }),
      { params: Promise.resolve({ id: "proj_1" }) },
    );
    expect(res.status).toBe(200);
    // UPDATE sets provider_id as 7th positional param (0-indexed 6).
    expect(updateParams[6]).toBeNull();
  });

  test("forwards provider_id: string to assign", async () => {
    let updateParams: unknown[] = [];
    const existing = makeProject({ provider_id: null });
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        sql: string;
        params?: unknown[];
      };
      if (/^SELECT \* FROM projects WHERE id/i.test(body.sql)) {
        return d1Success([existing]);
      }
      if (/^UPDATE projects/i.test(body.sql)) {
        updateParams = body.params ?? [];
        return d1Success([]);
      }
      return d1Success([]);
    });
    const { PUT } = await import("@/app/api/projects/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/projects/proj_1", "PUT", {
        provider_id: "prov_new",
      }),
      { params: Promise.resolve({ id: "proj_1" }) },
    );
    expect(res.status).toBe(200);
    expect(updateParams[6]).toBe("prov_new");
  });

  test("preserves provider_id when omitted from PUT", async () => {
    let updateParams: unknown[] = [];
    const existing = makeProject({ provider_id: "prov_stay" });
    globalThis.fetch = mockFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        sql: string;
        params?: unknown[];
      };
      if (/^SELECT \* FROM projects WHERE id/i.test(body.sql)) {
        return d1Success([existing]);
      }
      if (/^UPDATE projects/i.test(body.sql)) {
        updateParams = body.params ?? [];
        return d1Success([]);
      }
      return d1Success([]);
    });
    const { PUT } = await import("@/app/api/projects/[id]/route");
    const res = await PUT(
      jsonRequest("http://x/api/projects/proj_1", "PUT", { name: "Renamed" }),
      { params: Promise.resolve({ id: "proj_1" }) },
    );
    expect(res.status).toBe(200);
    expect(updateParams[6]).toBe("prov_stay");
  });
});
