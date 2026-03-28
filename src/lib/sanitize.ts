/**
 * Strip sensitive credentials from project records before sending to clients.
 *
 * Uses field allowlisting (not deletion) to prevent future schema
 * additions from being accidentally exposed.
 */

import type { Project } from "@/lib/db/projects";

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
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}
