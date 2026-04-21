/**
 * Project database operations (Cloudflare D1 native binding).
 */

import { query, queryOne, execute } from "./d1";
import { generateId, generateWebhookToken } from "@/lib/id";

export type { Project } from "@/lib/types/project";
import type { Project } from "@/lib/types/project";

/**
 * List all projects, ordered by creation date descending.
 */
export async function listProjects(db: D1Database): Promise<Project[]> {
  return query<Project>(db, "SELECT * FROM projects ORDER BY created_at DESC");
}

/**
 * Get a single project by ID.
 */
export async function getProject(
  db: D1Database,
  id: string,
): Promise<Project | null> {
  return queryOne<Project>(db, "SELECT * FROM projects WHERE id = ?", [id]);
}

/**
 * Get a project by its webhook token.
 */
export async function getProjectByToken(
  db: D1Database,
  token: string,
): Promise<Project | null> {
  return queryOne<Project>(
    db,
    "SELECT * FROM projects WHERE webhook_token = ?",
    [token],
  );
}

/**
 * Create a new project.
 */
export async function createProject(
  db: D1Database,
  data: {
    name: string;
    description?: string | undefined;
    email_prefix: string;
    from_name: string;
    quota_daily?: number | undefined;
    quota_monthly?: number | undefined;
    provider_id?: string | null | undefined;
  },
): Promise<Project> {
  const id = generateId();
  const token = generateWebhookToken();
  const now = new Date().toISOString();
  const quota_daily = data.quota_daily ?? 100;
  const quota_monthly = data.quota_monthly ?? 1000;
  const provider_id = data.provider_id ?? null;

  await execute(
    db,
    `INSERT INTO projects (id, name, description, email_prefix, from_name, webhook_token, quota_daily, quota_monthly, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name,
      data.description ?? null,
      data.email_prefix,
      data.from_name,
      token,
      quota_daily,
      quota_monthly,
      provider_id,
      now,
      now,
    ],
  );

  return {
    id,
    name: data.name,
    description: data.description ?? null,
    email_prefix: data.email_prefix,
    from_name: data.from_name,
    webhook_token: token,
    quota_daily,
    quota_monthly,
    provider_id,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Update a project's settings.
 *
 * provider_id accepts three shapes:
 *   - undefined → unchanged
 *   - null      → unassign (legacy mode)
 *   - string    → set to that provider
 */
export async function updateProject(
  db: D1Database,
  id: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    email_prefix?: string | undefined;
    from_name?: string | undefined;
    quota_daily?: number | undefined;
    quota_monthly?: number | undefined;
    provider_id?: string | null | undefined;
  },
): Promise<Project | null> {
  const existing = await getProject(db, id);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const description =
    data.description !== undefined ? data.description : existing.description;
  const email_prefix = data.email_prefix ?? existing.email_prefix;
  const from_name = data.from_name ?? existing.from_name;
  const quota_daily = data.quota_daily ?? existing.quota_daily;
  const quota_monthly = data.quota_monthly ?? existing.quota_monthly;
  const provider_id =
    data.provider_id !== undefined ? data.provider_id : existing.provider_id;
  const now = new Date().toISOString();

  await execute(
    db,
    `UPDATE projects SET name = ?, description = ?, email_prefix = ?, from_name = ?,
     quota_daily = ?, quota_monthly = ?, provider_id = ?, updated_at = ? WHERE id = ?`,
    [
      name,
      description,
      email_prefix,
      from_name,
      quota_daily,
      quota_monthly,
      provider_id,
      now,
      id,
    ],
  );

  return {
    ...existing,
    name,
    description,
    email_prefix,
    from_name,
    quota_daily,
    quota_monthly,
    provider_id,
    updated_at: now,
  };
}

/**
 * Delete a project by ID. Cascades to recipients, templates, send_logs, webhook_logs.
 */
export async function deleteProject(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const existing = await getProject(db, id);
  if (!existing) return false;

  await execute(db, "DELETE FROM projects WHERE id = ?", [id]);
  return true;
}

/**
 * Regenerate a project's webhook token.
 * Returns the new plaintext token (shown once).
 */
export async function regenerateToken(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const existing = await getProject(db, id);
  if (!existing) return null;

  const token = generateWebhookToken();
  const now = new Date().toISOString();

  await execute(
    db,
    "UPDATE projects SET webhook_token = ?, updated_at = ? WHERE id = ?",
    [token, now, id],
  );

  return token;
}
