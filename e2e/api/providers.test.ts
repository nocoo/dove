/**
 * E2E: Providers API — full CRUD + health check.
 *
 * Real HTTP against running dev server on port 17034.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { get, post, put, del, parseJson } from "./helpers";

interface ProviderRow {
  id: string;
  name: string;
  type: "resend" | "cloudflare";
  domain: string;
  config: Record<string, string>;
}

let providerId: string;

let domainCounter = 0;
const baseProvider = () => ({
  name: `E2E Provider ${Date.now()}`,
  type: "resend" as const,
  domain: `e2e-${Date.now()}-${++domainCounter}.example.com`,
  config: { api_key: "re_test_" + Date.now() },
});

beforeAll(async () => {
  const res = await post("/api/providers", { body: baseProvider() });
  if (res.status !== 201) {
    throw new Error(`Failed to seed provider (${res.status}): ${await res.text()}`);
  }
  const body = await parseJson<ProviderRow>(res);
  providerId = body.id;
});

afterAll(async () => {
  if (providerId) await del(`/api/providers/${providerId}`);
});

describe("GET /api/providers", () => {
  test("returns providers with api_key masked", async () => {
    const res = await get("/api/providers");
    expect(res.status).toBe(200);
    const body = await parseJson<ProviderRow[]>(res);
    expect(Array.isArray(body)).toBe(true);
    const seeded = body.find((p) => p.id === providerId);
    expect(seeded).toBeDefined();
    // sanitizeProvider should not leak the raw api_key
    if (seeded?.config?.api_key) {
      expect(seeded.config.api_key).not.toMatch(/^re_test_/);
    }
  });
});

describe("POST /api/providers", () => {
  test("rejects invalid type", async () => {
    const res = await post("/api/providers", {
      body: { ...baseProvider(), type: "smtp" },
    });
    expect(res.status).toBe(400);
  });

  test("rejects invalid resend config (missing api_key)", async () => {
    const res = await post("/api/providers", {
      body: { ...baseProvider(), config: {} },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/providers/:id", () => {
  test("returns the provider", async () => {
    const res = await get(`/api/providers/${providerId}`);
    expect(res.status).toBe(200);
    const body = await parseJson<ProviderRow>(res);
    expect(body.id).toBe(providerId);
  });

  test("returns 404 for unknown id", async () => {
    const res = await get("/api/providers/nonexistent_id_12345");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/providers/:id", () => {
  test("updates the name", async () => {
    const res = await put(`/api/providers/${providerId}`, {
      body: { name: "Renamed E2E" },
    });
    expect(res.status).toBe(200);
    const body = await parseJson<ProviderRow>(res);
    expect(body.name).toBe("Renamed E2E");
  });

  test("returns 404 for unknown id", async () => {
    const res = await put("/api/providers/nonexistent_id_12345", {
      body: { name: "x" },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/providers/:id/health", () => {
  test("returns health for an existing provider", async () => {
    const res = await get(`/api/providers/${providerId}/health`);
    expect(res.status).toBe(200);
    const body = await parseJson<{
      id: string;
      healthy: boolean;
      configValid: boolean;
      checkedAt: string;
    }>(res);
    expect(body.id).toBe(providerId);
    expect(typeof body.healthy).toBe("boolean");
    expect(body.configValid).toBe(true);
    expect(typeof body.checkedAt).toBe("string");
  });

  test("returns 404 for unknown id", async () => {
    const res = await get("/api/providers/nonexistent_id_12345/health");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/providers/:id", () => {
  test("returns 404 for unknown id", async () => {
    const res = await del("/api/providers/nonexistent_id_12345");
    expect(res.status).toBe(404);
  });

  test("deletes successfully when not in use", async () => {
    const create = await post("/api/providers", { body: baseProvider() });
    const created = await parseJson<ProviderRow>(create);
    const res = await del(`/api/providers/${created.id}`);
    expect(res.status).toBe(204);
  });
});
