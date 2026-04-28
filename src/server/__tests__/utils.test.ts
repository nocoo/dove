import { describe, test, expect } from "vitest";
import { generateId, generateWebhookToken } from "../lib/id";
import { parsePagination } from "../lib/pagination";
import { sanitizeProject, sanitizeProvider } from "../lib/sanitize";
import type { Project } from "../lib/db/projects";
import type { EmailProviderRecord } from "../lib/db/email-providers";

describe("id", () => {
  test("generateId returns 21-char string", () => {
    expect(generateId()).toHaveLength(21);
  });

  test("generateWebhookToken returns 48-char string", () => {
    expect(generateWebhookToken()).toHaveLength(48);
  });

  test("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("pagination", () => {
  test("defaults to page 1, limit 20", () => {
    const url = new URL("http://x.com/api/logs");
    const { page, limit, offset } = parsePagination(url);
    expect(page).toBe(1);
    expect(limit).toBe(20);
    expect(offset).toBe(0);
  });

  test("parses page and limit from query", () => {
    const url = new URL("http://x.com/api/logs?page=3&limit=50");
    const { page, limit, offset } = parsePagination(url);
    expect(page).toBe(3);
    expect(limit).toBe(50);
    expect(offset).toBe(100);
  });

  test("clamps limit to 100", () => {
    const url = new URL("http://x.com/api/logs?limit=999");
    expect(parsePagination(url).limit).toBe(100);
  });

  test("clamps page to minimum 1", () => {
    const url = new URL("http://x.com/api/logs?page=-5");
    expect(parsePagination(url).page).toBe(1);
  });
});

describe("sanitize", () => {
  const project: Project = {
    id: "p1",
    name: "Test",
    description: null,
    email_prefix: "noreply",
    from_name: "Test",
    webhook_token: "super-secret-token",
    quota_daily: 100,
    quota_monthly: 1000,
    provider_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  test("sanitizeProject removes webhook_token", () => {
    const sanitized = sanitizeProject(project);
    expect(sanitized).not.toHaveProperty("webhook_token");
    expect(sanitized.id).toBe("p1");
    expect(sanitized.name).toBe("Test");
  });

  test("sanitizeProvider masks api_key", () => {
    const provider: EmailProviderRecord = {
      id: "prov1",
      name: "Resend",
      type: "resend",
      domain: "example.com",
      config: JSON.stringify({ api_key: "re_1234567890abcdef" }),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const sanitized = sanitizeProvider(provider);
    expect(sanitized.config.api_key).toBe("••••••cdef");
    expect(sanitized.id).toBe("prov1");
  });

  test("sanitizeProvider handles invalid JSON config", () => {
    const provider: EmailProviderRecord = {
      id: "prov2",
      name: "Bad",
      type: "resend",
      domain: "example.com",
      config: "not-json",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const sanitized = sanitizeProvider(provider);
    expect(sanitized.config).toEqual({});
  });

  test("sanitizeProvider preserves non-sensitive fields", () => {
    const provider: EmailProviderRecord = {
      id: "prov3",
      name: "CF",
      type: "cloudflare",
      domain: "example.com",
      config: JSON.stringify({}),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const sanitized = sanitizeProvider(provider);
    expect(Object.keys(sanitized.config)).toHaveLength(0);
  });
});
