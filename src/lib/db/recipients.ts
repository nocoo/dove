/**
 * Recipient database operations.
 *
 * Each project maintains a whitelist of recipients.
 * All email addresses are normalized: trim().toLowerCase().
 */

import { executeD1Query } from "./d1-client";
import { generateId } from "@/lib/id";

export interface Recipient {
  id: string;
  project_id: string;
  name: string;
  email: string;
  created_at: string;
}

/** Normalize email: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * List all recipients for a project, ordered by creation date descending.
 */
export async function listRecipients(projectId: string): Promise<Recipient[]> {
  return executeD1Query<Recipient>(
    "SELECT * FROM recipients WHERE project_id = ? ORDER BY created_at DESC",
    [projectId],
  );
}

/**
 * Get a single recipient by ID.
 */
export async function getRecipient(id: string): Promise<Recipient | undefined> {
  const rows = await executeD1Query<Recipient>(
    "SELECT * FROM recipients WHERE id = ?",
    [id],
  );
  return rows[0];
}

/**
 * Get a recipient by project ID and email (normalized).
 */
export async function getRecipientByEmail(
  projectId: string,
  email: string,
): Promise<Recipient | undefined> {
  const rows = await executeD1Query<Recipient>(
    "SELECT * FROM recipients WHERE project_id = ? AND email = ?",
    [projectId, normalizeEmail(email)],
  );
  return rows[0];
}

/**
 * Create a new recipient for a project.
 * Throws "UNIQUE constraint failed" if email already exists in project.
 */
export async function createRecipient(data: {
  project_id: string;
  name: string;
  email: string;
}): Promise<Recipient> {
  const id = generateId();
  const now = new Date().toISOString();
  const email = normalizeEmail(data.email);

  await executeD1Query(
    "INSERT INTO recipients (id, project_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, data.project_id, data.name, email, now],
  );

  return {
    id,
    project_id: data.project_id,
    name: data.name,
    email,
    created_at: now,
  };
}

/**
 * Update a recipient's name and/or email.
 */
export async function updateRecipient(
  id: string,
  data: {
    name?: string;
    email?: string;
  },
): Promise<Recipient | undefined> {
  const existing = await getRecipient(id);
  if (!existing) return undefined;

  const name = data.name ?? existing.name;
  const email = data.email ? normalizeEmail(data.email) : existing.email;

  await executeD1Query(
    "UPDATE recipients SET name = ?, email = ? WHERE id = ?",
    [name, email, id],
  );

  return { ...existing, name, email };
}

/**
 * Delete a recipient by ID.
 */
export async function deleteRecipient(id: string): Promise<boolean> {
  const existing = await getRecipient(id);
  if (!existing) return false;

  await executeD1Query("DELETE FROM recipients WHERE id = ?", [id]);
  return true;
}
