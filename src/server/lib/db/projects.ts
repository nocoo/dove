/**
 * Project database operations (Cloudflare D1 native binding).
 */

import { generateId, generateWebhookToken } from "@/lib/id";
import { execute, query, queryOne } from "./d1";

export type { Project } from "@/lib/types/project";

import type { Project } from "@/lib/types/project";

/**
 * D1 stores booleans as INTEGER (0/1). The TS Project type exposes them as
 * `boolean` for ergonomic call-sites — this row mapper is the single point
 * where SQLite's representation is converted. Keep it in sync with the
 * Project interface.
 */
type ProjectRow = Omit<Project, "allow_unknown_recipients"> & {
	allow_unknown_recipients: number | boolean | null;
};

function fromRow(row: ProjectRow): Project {
	return {
		...row,
		allow_unknown_recipients:
			row.allow_unknown_recipients === 1 || row.allow_unknown_recipients === true,
	};
}

/**
 * List all projects, ordered by creation date descending.
 */
export async function listProjects(db: D1Database): Promise<Project[]> {
	const rows = await query<ProjectRow>(db, "SELECT * FROM projects ORDER BY created_at DESC");
	return rows.map(fromRow);
}

/**
 * Get a single project by ID.
 */
export async function getProject(db: D1Database, id: string): Promise<Project | null> {
	const row = await queryOne<ProjectRow>(db, "SELECT * FROM projects WHERE id = ?", [id]);
	return row ? fromRow(row) : null;
}

/**
 * Get a project by its webhook token.
 */
export async function getProjectByToken(db: D1Database, token: string): Promise<Project | null> {
	const row = await queryOne<ProjectRow>(db, "SELECT * FROM projects WHERE webhook_token = ?", [
		token,
	]);
	return row ? fromRow(row) : null;
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
		allow_unknown_recipients?: boolean | undefined;
	},
): Promise<Project> {
	const id = generateId();
	const token = generateWebhookToken();
	const now = new Date().toISOString();
	const quota_daily = data.quota_daily ?? 100;
	const quota_monthly = data.quota_monthly ?? 1000;
	const provider_id = data.provider_id ?? null;
	// Defaults to false — opting INTO unbounded recipients is always explicit.
	const allow_unknown_recipients = data.allow_unknown_recipients ?? false;

	await execute(
		db,
		`INSERT INTO projects (id, name, description, email_prefix, from_name, webhook_token, quota_daily, quota_monthly, provider_id, allow_unknown_recipients, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			allow_unknown_recipients ? 1 : 0,
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
		allow_unknown_recipients,
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
		allow_unknown_recipients?: boolean | undefined;
	},
): Promise<Project | null> {
	const existing = await getProject(db, id);
	if (!existing) return null;

	const name = data.name ?? existing.name;
	const description = data.description !== undefined ? data.description : existing.description;
	const email_prefix = data.email_prefix ?? existing.email_prefix;
	const from_name = data.from_name ?? existing.from_name;
	const quota_daily = data.quota_daily ?? existing.quota_daily;
	const quota_monthly = data.quota_monthly ?? existing.quota_monthly;
	const provider_id = data.provider_id !== undefined ? data.provider_id : existing.provider_id;
	const allow_unknown_recipients =
		data.allow_unknown_recipients !== undefined
			? data.allow_unknown_recipients
			: existing.allow_unknown_recipients;
	const now = new Date().toISOString();

	await execute(
		db,
		`UPDATE projects SET name = ?, description = ?, email_prefix = ?, from_name = ?,
     quota_daily = ?, quota_monthly = ?, provider_id = ?, allow_unknown_recipients = ?, updated_at = ? WHERE id = ?`,
		[
			name,
			description,
			email_prefix,
			from_name,
			quota_daily,
			quota_monthly,
			provider_id,
			allow_unknown_recipients ? 1 : 0,
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
		allow_unknown_recipients,
		updated_at: now,
	};
}

/**
 * Delete a project by ID. Cascades to recipients, templates, send_logs, webhook_logs.
 */
export async function deleteProject(db: D1Database, id: string): Promise<boolean> {
	const existing = await getProject(db, id);
	if (!existing) return false;

	await execute(db, "DELETE FROM projects WHERE id = ?", [id]);
	return true;
}

/**
 * Regenerate a project's webhook token.
 * Returns the new plaintext token (shown once).
 */
export async function regenerateToken(db: D1Database, id: string): Promise<string | null> {
	const existing = await getProject(db, id);
	if (!existing) return null;

	const token = generateWebhookToken();
	const now = new Date().toISOString();

	await execute(db, "UPDATE projects SET webhook_token = ?, updated_at = ? WHERE id = ?", [
		token,
		now,
		id,
	]);

	return token;
}
