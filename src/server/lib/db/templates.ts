/**
 * Template database operations (Cloudflare D1 native binding).
 *
 * Templates use Markdown body with {{var}} substitution.
 * Variables are declared as a JSON array in the `variables` column.
 */

import { query, queryOne, execute } from "./d1";
import { generateId } from "@/lib/id";

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string | undefined;
}

export interface Template {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  subject: string;
  body_markdown: string;
  variables: string; // JSON string of TemplateVariable[]
  created_at: string;
  updated_at: string;
}

/**
 * Parse the variables JSON column into typed array.
 */
export function parseVariables(template: Template): TemplateVariable[] {
  try {
    return JSON.parse(template.variables) as TemplateVariable[];
  } catch {
    return [];
  }
}

/**
 * List all templates for a project, ordered by creation date descending.
 */
export async function listTemplates(
  db: D1Database,
  projectId: string,
): Promise<Template[]> {
  return query<Template>(
    db,
    "SELECT * FROM templates WHERE project_id = ? ORDER BY created_at DESC",
    [projectId],
  );
}

/**
 * List all templates across all projects.
 */
export async function listAllTemplates(db: D1Database): Promise<Template[]> {
  return query<Template>(
    db,
    "SELECT * FROM templates ORDER BY created_at DESC",
  );
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(
  db: D1Database,
  id: string,
): Promise<Template | null> {
  return queryOne<Template>(db, "SELECT * FROM templates WHERE id = ?", [id]);
}

/**
 * Get a template by project ID and slug.
 */
export async function getTemplateBySlug(
  db: D1Database,
  projectId: string,
  slug: string,
): Promise<Template | null> {
  return queryOne<Template>(
    db,
    "SELECT * FROM templates WHERE project_id = ? AND slug = ?",
    [projectId, slug],
  );
}

/**
 * Create a new template.
 * Throws "UNIQUE constraint failed" if slug already exists in project.
 */
export async function createTemplate(
  db: D1Database,
  data: {
    project_id: string;
    name: string;
    slug: string;
    subject: string;
    body_markdown: string;
    variables?: TemplateVariable[] | undefined;
  },
): Promise<Template> {
  const id = generateId();
  const now = new Date().toISOString();
  const variables = JSON.stringify(data.variables ?? []);

  await execute(
    db,
    `INSERT INTO templates (id, project_id, name, slug, subject, body_markdown, variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.project_id,
      data.name,
      data.slug,
      data.subject,
      data.body_markdown,
      variables,
      now,
      now,
    ],
  );

  return {
    id,
    project_id: data.project_id,
    name: data.name,
    slug: data.slug,
    subject: data.subject,
    body_markdown: data.body_markdown,
    variables,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Update a template.
 */
export async function updateTemplate(
  db: D1Database,
  id: string,
  data: {
    name?: string | undefined;
    slug?: string | undefined;
    subject?: string | undefined;
    body_markdown?: string | undefined;
    variables?: TemplateVariable[] | undefined;
  },
): Promise<Template | null> {
  const existing = await getTemplate(db, id);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const slug = data.slug ?? existing.slug;
  const subject = data.subject ?? existing.subject;
  const body_markdown = data.body_markdown ?? existing.body_markdown;
  const variables = data.variables
    ? JSON.stringify(data.variables)
    : existing.variables;
  const now = new Date().toISOString();

  await execute(
    db,
    `UPDATE templates SET name = ?, slug = ?, subject = ?, body_markdown = ?, variables = ?, updated_at = ? WHERE id = ?`,
    [name, slug, subject, body_markdown, variables, now, id],
  );

  return {
    ...existing,
    name,
    slug,
    subject,
    body_markdown,
    variables,
    updated_at: now,
  };
}

/**
 * Delete a template by ID.
 */
export async function deleteTemplate(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const existing = await getTemplate(db, id);
  if (!existing) return false;

  await execute(db, "DELETE FROM templates WHERE id = ?", [id]);
  return true;
}
