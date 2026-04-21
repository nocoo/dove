/**
 * Strip sensitive credentials from DB records before sending to clients.
 *
 * Uses field allowlisting (not deletion) to prevent future schema
 * additions from being accidentally exposed.
 */

import type { Project } from "@/lib/types/project";
import type { EmailProviderRecord } from "@/lib/types/email-provider";

/** Sanitized project type — webhook_token removed. */
export type SanitizedProject = Omit<Project, "webhook_token">;

/**
 * Remove webhook_token from a project record.
 * Returns a new object — does not mutate the input.
 */
export function sanitizeProject(project: Project): SanitizedProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    email_prefix: project.email_prefix,
    from_name: project.from_name,
    quota_daily: project.quota_daily,
    quota_monthly: project.quota_monthly,
    provider_id: project.provider_id,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

/**
 * Sanitized provider type — config returned as an object with
 * masked credentials (api_key shows only the last 4 chars).
 */
export interface SanitizedProvider {
  id: string;
  name: string;
  type: EmailProviderRecord["type"];
  domain: string;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

/**
 * Mask sensitive fields in an email_providers record.
 *   api_key   → "••••••" + last 4 chars
 *   worker_url → kept as-is (URLs are not credentials)
 * Any other string fields are preserved without masking. Unknown
 * non-string fields are dropped to prevent accidental leaks.
 */
export function sanitizeProvider(
  provider: EmailProviderRecord,
): SanitizedProvider {
  let raw: unknown = {};
  try {
    raw = JSON.parse(provider.config);
  } catch {
    raw = {};
  }
  const config: Record<string, string> =
    raw && typeof raw === "object" ? (raw as Record<string, string>) : {};

  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    if (key === "api_key") {
      masked[key] = value.length > 4
        ? "••••••" + value.slice(-4)
        : "••••••";
    } else {
      masked[key] = value;
    }
  }

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    domain: provider.domain,
    config: masked,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  };
}
