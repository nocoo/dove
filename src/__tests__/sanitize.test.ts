import { describe, expect, test } from "vitest";
import { sanitizeProject, sanitizeProvider } from "@/lib/sanitize";
import type { Project } from "@/lib/types/project";
import type { EmailProviderRecord } from "@/lib/types/email-provider";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_test1",
    name: "Test Project",
    description: "A test project",
    email_prefix: "noreply",
    from_name: "Test",
    webhook_token: "tok_secret",
    quota_daily: 100,
    quota_monthly: 1000,
    provider_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProvider(
  overrides: Partial<EmailProviderRecord> = {},
): EmailProviderRecord {
  return {
    id: "prov_1",
    name: "Main Resend",
    type: "resend",
    domain: "mail.example.com",
    config: JSON.stringify({ api_key: "re_live_1234567890abcdef" }),
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("sanitizeProject", () => {
  test("removes webhook_token", () => {
    const project = makeProject({ webhook_token: "secret_token_value" });
    const sanitized = sanitizeProject(project);
    expect(sanitized).not.toHaveProperty("webhook_token");
  });

  test("preserves all other fields including provider_id", () => {
    const project = makeProject({ provider_id: "prov_abc" });
    const sanitized = sanitizeProject(project);

    expect(sanitized.id).toBe(project.id);
    expect(sanitized.name).toBe(project.name);
    expect(sanitized.description).toBe(project.description);
    expect(sanitized.email_prefix).toBe(project.email_prefix);
    expect(sanitized.from_name).toBe(project.from_name);
    expect(sanitized.quota_daily).toBe(project.quota_daily);
    expect(sanitized.quota_monthly).toBe(project.quota_monthly);
    expect(sanitized.provider_id).toBe("prov_abc");
    expect(sanitized.created_at).toBe(project.created_at);
    expect(sanitized.updated_at).toBe(project.updated_at);
  });

  test("does not mutate the original project", () => {
    const project = makeProject();
    sanitizeProject(project);
    expect(project.webhook_token).toBeDefined();
  });
});

describe("sanitizeProvider", () => {
  test("masks api_key to last 4 chars", () => {
    const p = sanitizeProvider(makeProvider());
    expect(p.config["api_key"]).toBe("••••••cdef");
    expect(p.config["api_key"]).not.toContain("re_live");
  });

  test("handles empty cloudflare config", () => {
    const p = sanitizeProvider(
      makeProvider({
        type: "cloudflare",
        config: JSON.stringify({}),
      }),
    );
    expect(Object.keys(p.config)).toHaveLength(0);
  });

  test("masks short api_key entirely", () => {
    const p = sanitizeProvider(
      makeProvider({ config: JSON.stringify({ api_key: "abc" }) }),
    );
    expect(p.config["api_key"]).toBe("••••••");
  });

  test("preserves non-sensitive metadata fields", () => {
    const record = makeProvider({ name: "My Resend" });
    const p = sanitizeProvider(record);
    expect(p.id).toBe(record.id);
    expect(p.name).toBe("My Resend");
    expect(p.type).toBe("resend");
    expect(p.domain).toBe(record.domain);
    expect(p.created_at).toBe(record.created_at);
    expect(p.updated_at).toBe(record.updated_at);
  });

  test("drops non-string config values", () => {
    const p = sanitizeProvider(
      makeProvider({
        config: JSON.stringify({
          api_key: "abcd1234",
          nested: { secret: "x" },
          num: 1,
        }),
      }),
    );
    expect(p.config).not.toHaveProperty("nested");
    expect(p.config).not.toHaveProperty("num");
    expect(p.config["api_key"]).toBe("••••••1234");
  });

  test("yields empty config on malformed JSON", () => {
    const p = sanitizeProvider(makeProvider({ config: "{not json" }));
    expect(p.config).toEqual({});
  });
});
