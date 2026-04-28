import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { providers } from "../routes/providers";

const sampleProvider = {
  id: "prov_001",
  name: "Resend Prod",
  type: "resend",
  domain: "example.com",
  config: JSON.stringify({ api_key: "re_1234567890abcdef" }),
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
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
  app.route("/", providers);
  return {
    req: (path: string, init?: RequestInit) =>
      app.request(path, init, { DB: db } as unknown as Env),
  };
}

describe("providers route handlers", () => {
  test("GET / returns sanitized list", async () => {
    const { req } = createApp(createMockDB({ allResults: [sampleProvider] }));
    const res = await req("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { api_key: string } }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.config.api_key).toContain("••••••");
  });

  test("POST / creates provider 201", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New",
        type: "resend",
        domain: "mail.example.com",
        config: { api_key: "re_test123" },
      }),
    });
    expect(res.status).toBe(201);
  });

  test("POST / returns 400 for invalid config", async () => {
    const { req } = createApp(createMockDB());
    const res = await req("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad",
        type: "resend",
        domain: "mail.example.com",
        config: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /:id returns sanitized provider", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
    const res = await req("/prov_001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { api_key: string } };
    expect(body.config.api_key).toContain("••••••");
  });

  test("GET /:id returns 404", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/missing");
    expect(res.status).toBe(404);
  });

  test("PUT /:id updates provider", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
    const res = await req("/prov_001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
  });

  test("DELETE /:id returns 204 when not in use", async () => {
    const { req } = createApp(createMockDB({ firstResult: { count: 0, ...sampleProvider } }));
    const res = await req("/prov_001", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("GET /:id/health returns health status for resend", async () => {
    const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
    const res = await req("/prov_001/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { healthy: boolean; configValid: boolean; reachable: null };
    expect(body.healthy).toBe(true);
    expect(body.configValid).toBe(true);
    expect(body.reachable).toBeNull();
  });

  test("GET /:id/health returns 404 for missing provider", async () => {
    const { req } = createApp(createMockDB({ firstResult: null }));
    const res = await req("/missing/health");
    expect(res.status).toBe(404);
  });
});
