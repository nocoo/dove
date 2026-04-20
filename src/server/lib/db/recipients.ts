/**
 * Recipient database operations (Cloudflare D1 native binding).
 *
 * Each project maintains a whitelist of recipients.
 * All email addresses are normalized: trim().toLowerCase().
 */

import { query, queryOne, execute } from "./d1";
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
export async function listRecipients(
  db: D1Database,
  projectId: string,
): Promise<Recipient[]> {
  return query<Recipient>(
    db,
    "SELECT * FROM recipients WHERE project_id = ? ORDER BY created_at DESC",
    [projectId],
  );
}

/**
 * Get a single recipient by ID.
 */
export async function getRecipient(
  db: D1Database,
  id: string,
): Promise<Recipient | null> {
  return queryOne<Recipient>(db, "SELECT * FROM recipients WHERE id = ?", [id]);
}

/**
 * Get a recipient by project ID and email (normalized).
 */
export async function getRecipientByEmail(
  db: D1Database,
  projectId: string,
  email: string,
): Promise<Recipient | null> {
  return queryOne<Recipient>(
    db,
    "SELECT * FROM recipients WHERE project_id = ? AND email = ?",
    [projectId, normalizeEmail(email)],
  );
}

/**
 * Create a new recipient for a project.
 * Throws "UNIQUE constraint failed" if email already exists in project.
 */
export async function createRecipient(
  db: D1Database,
  data: {
    project_id: string;
    name: string;
    email: string;
  },
): Promise<Recipient> {
  const id = generateId();
  const now = new Date().toISOString();
  const email = normalizeEmail(data.email);

  await execute(
    db,
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
  db: D1Database,
  id: string,
  data: {
    name?: string | undefined;
    email?: string | undefined;
  },
): Promise<Recipient | null> {
  const existing = await getRecipient(db, id);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const email = data.email ? normalizeEmail(data.email) : existing.email;

  await execute(db, "UPDATE recipients SET name = ?, email = ? WHERE id = ?", [
    name,
    email,
    id,
  ]);

  return { ...existing, name, email };
}

/**
 * Delete a recipient by ID.
 */
export async function deleteRecipient(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const existing = await getRecipient(db, id);
  if (!existing) return false;

  await execute(db, "DELETE FROM recipients WHERE id = ?", [id]);
  return true;
}
