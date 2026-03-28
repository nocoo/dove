/**
 * Project database operations.
 */

import { executeD1Query } from "./d1-client";
import { generateId, generateWebhookToken } from "@/lib/id";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  email_prefix: string;
  from_name: string;
  webhook_token: string;
  quota_daily: number;
  quota_monthly: number;
  created_at: string;
  updated_at: string;
}

/**
 * List all projects, ordered by creation date descending.
 */
export async function listProjects(): Promise<Project[]> {
  return executeD1Query<Project>(
    "SELECT * FROM projects ORDER BY created_at DESC",
  );
}

/**
 * Get a single project by ID.
 */
export async function getProject(id: string): Promise<Project | undefined> {
  const rows = await executeD1Query<Project>(
    "SELECT * FROM projects WHERE id = ?",
    [id],
  );
  return rows[0];
}

/**
 * Get a project by its webhook token.
 */
export async function getProjectByToken(
  token: string,
): Promise<Project | undefined> {
  const rows = await executeD1Query<Project>(
    "SELECT * FROM projects WHERE webhook_token = ?",
    [token],
  );
  return rows[0];
}

/**
 * Create a new project.
 */
export async function createProject(data: {
  name: string;
  description?: string | undefined;
  email_prefix: string;
  from_name: string;
  quota_daily?: number | undefined;
  quota_monthly?: number | undefined;
}): Promise<Project> {
  const id = generateId();
  const token = generateWebhookToken();
  const now = new Date().toISOString();
  const quota_daily = data.quota_daily ?? 100;
  const quota_monthly = data.quota_monthly ?? 1000;

  await executeD1Query(
    `INSERT INTO projects (id, name, description, email_prefix, from_name, webhook_token, quota_daily, quota_monthly, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.description ?? null, data.email_prefix, data.from_name, token, quota_daily, quota_monthly, now, now],
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
    created_at: now,
    updated_at: now,
  };
}

/**
 * Update a project's settings.
 */
export async function updateProject(
  id: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    email_prefix?: string | undefined;
    from_name?: string | undefined;
    quota_daily?: number | undefined;
    quota_monthly?: number | undefined;
  },
): Promise<Project | undefined> {
  const existing = await getProject(id);
  if (!existing) return undefined;

  const name = data.name ?? existing.name;
  const description = data.description !== undefined ? data.description : existing.description;
  const email_prefix = data.email_prefix ?? existing.email_prefix;
  const from_name = data.from_name ?? existing.from_name;
  const quota_daily = data.quota_daily ?? existing.quota_daily;
  const quota_monthly = data.quota_monthly ?? existing.quota_monthly;
  const now = new Date().toISOString();

  await executeD1Query(
    `UPDATE projects SET name = ?, description = ?, email_prefix = ?, from_name = ?,
     quota_daily = ?, quota_monthly = ?, updated_at = ? WHERE id = ?`,
    [name, description, email_prefix, from_name, quota_daily, quota_monthly, now, id],
  );

  return { ...existing, name, description, email_prefix, from_name, quota_daily, quota_monthly, updated_at: now };
}

/**
 * Delete a project by ID. Cascades to recipients, templates, send_logs, webhook_logs.
 */
export async function deleteProject(id: string): Promise<boolean> {
  const existing = await getProject(id);
  if (!existing) return false;

  await executeD1Query("DELETE FROM projects WHERE id = ?", [id]);
  return true;
}

/**
 * Regenerate a project's webhook token.
 * Returns the new plaintext token (shown once).
 */
export async function regenerateToken(
  id: string,
): Promise<string | undefined> {
  const existing = await getProject(id);
  if (!existing) return undefined;

  const token = generateWebhookToken();
  const now = new Date().toISOString();

  await executeD1Query(
    "UPDATE projects SET webhook_token = ?, updated_at = ? WHERE id = ?",
    [token, now, id],
  );

  return token;
}
