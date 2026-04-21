import type { Project } from "./db/projects";
import type { EmailProviderRecord } from "./db/email-providers";

export type SanitizedProject = Omit<Project, "webhook_token">;

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

export interface SanitizedProvider {
  id: string;
  name: string;
  type: EmailProviderRecord["type"];
  domain: string;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

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
      masked[key] =
        value.length > 4 ? "••••••" + value.slice(-4) : "••••••";
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
