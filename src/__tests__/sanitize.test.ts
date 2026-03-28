import { describe, expect, test } from "bun:test";
import { sanitizeProject } from "@/lib/sanitize";
import { makeProject } from "./helpers";

describe("sanitizeProject", () => {
  test("removes webhook_token", () => {
    const project = makeProject({ webhook_token: "secret_token_value" });
    const sanitized = sanitizeProject(project);

    expect(sanitized).not.toHaveProperty("webhook_token");
  });

  test("preserves all other fields", () => {
    const project = makeProject();
    const sanitized = sanitizeProject(project);

    expect(sanitized.id).toBe(project.id);
    expect(sanitized.name).toBe(project.name);
    expect(sanitized.description).toBe(project.description);
    expect(sanitized.email_prefix).toBe(project.email_prefix);
    expect(sanitized.from_name).toBe(project.from_name);
    expect(sanitized.quota_daily).toBe(project.quota_daily);
    expect(sanitized.quota_monthly).toBe(project.quota_monthly);
    expect(sanitized.created_at).toBe(project.created_at);
    expect(sanitized.updated_at).toBe(project.updated_at);
  });

  test("does not mutate the original project", () => {
    const project = makeProject();
    sanitizeProject(project);
    expect(project.webhook_token).toBeDefined();
  });
});
