import { describe, test, expect } from "vitest";
import { parsePagination } from "../lib/pagination";
import { sanitizeProject, sanitizeProvider } from "../lib/sanitize";
import type { Project } from "../lib/db/projects";
import type { EmailProviderRecord } from "../lib/db/email-providers";

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
    allow_unknown_recipients: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  test("sanitizeProject removes webhook_token AND returns ONLY whitelisted fields", () => {
    const sanitized = sanitizeProject(project);
    expect(sanitized).not.toHaveProperty("webhook_token");
    expect(sanitized.id).toBe("p1");
    expect(sanitized.name).toBe("Test");
    // Pin the EXACT shape — a regression that copied additional fields
    // (e.g. via `...project`) would silently start exposing whatever
    // gets added to the Project type next (could be webhook_token's
    // replacement, or any future-secret column). Whitelist defense.
    expect(Object.keys(sanitized).sort()).toEqual([
      "allow_unknown_recipients",
      "created_at",
      "description",
      "email_prefix",
      "from_name",
      "id",
      "name",
      "provider_id",
      "quota_daily",
      "quota_monthly",
      "updated_at",
    ]);
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
    // Whitelist defense: same rationale as sanitizeProject — if the
    // EmailProviderRecord type adds a future-secret column (e.g. an
    // OAuth refresh token, a webhook signing secret), an accidental
    // `...provider` spread would leak it. Pin exact returned keys.
    expect(Object.keys(sanitized).sort()).toEqual([
      "config",
      "created_at",
      "domain",
      "id",
      "name",
      "type",
      "updated_at",
    ]);
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

  test("sanitizeProvider yields empty config when parsed value is null/scalar", () => {
    // Defensive: 'null' parses to null, '\"oops\"' parses to a string scalar.
    // Both must collapse to {} rather than be coerced through the Record cast.
    const base = {
      id: "prov_null",
      name: "X",
      type: "resend" as const,
      domain: "example.com",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(sanitizeProvider({ ...base, config: "null" }).config).toEqual({});
    expect(sanitizeProvider({ ...base, config: '"oops"' }).config).toEqual({});
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

  test("sanitizeProvider drops non-string config values", () => {
    // Defensive: a malformed provider row with a numeric/object config value
    // must not be exposed (would otherwise leak via Record<string,string> cast).
    const provider: EmailProviderRecord = {
      id: "prov4",
      name: "R",
      type: "resend",
      domain: "example.com",
      config: JSON.stringify({
        api_key: "re_long_key_value",
        rate_limit: 100, // numeric — must be skipped
        meta: { internal: "secret" }, // object — must be skipped
        region: "us-east-1", // non-secret string — must pass through
      }),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const sanitized = sanitizeProvider(provider);
    expect(sanitized.config).toEqual({ api_key: "••••••alue", region: "us-east-1" });
    expect(sanitized.config).not.toHaveProperty("rate_limit");
    expect(sanitized.config).not.toHaveProperty("meta");
  });

  test("sanitizeProvider fully masks short api_key without leaking suffix", () => {
    // api_key length <= 4 must collapse to bullets only (no slice-leak).
    const provider: EmailProviderRecord = {
      id: "prov5",
      name: "R",
      type: "resend",
      domain: "example.com",
      config: JSON.stringify({ api_key: "abcd" }),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const sanitized = sanitizeProvider(provider);
    expect(sanitized.config.api_key).toBe("••••••");
    expect(sanitized.config.api_key).not.toContain("a");
    expect(sanitized.config.api_key).not.toContain("d");
  });
});
