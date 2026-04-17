/**
 * D1 schema definitions and initialization.
 *
 * Tables: projects, recipients, templates, send_logs, webhook_logs, email_providers
 *
 * All IDs are nanoid (21-char). All timestamps are UTC strings
 * in format YYYY-MM-DDTHH:mm:ss.sssZ (trailing Z only).
 */

import { executeD1Query } from "./d1-client";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS email_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, domain)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  email_prefix TEXT NOT NULL,
  from_name TEXT NOT NULL,
  webhook_token TEXT NOT NULL UNIQUE,
  quota_daily INTEGER NOT NULL DEFAULT 100,
  quota_monthly INTEGER NOT NULL DEFAULT 1000,
  provider_id TEXT REFERENCES email_providers(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, email)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  payload_hash TEXT,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  recipient_id TEXT REFERENCES recipients(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  resend_id TEXT,
  provider_id TEXT,
  provider_type TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_webhook_token ON projects(webhook_token);

CREATE INDEX IF NOT EXISTS idx_recipients_project_id ON recipients(project_id);

CREATE INDEX IF NOT EXISTS idx_templates_project_id ON templates(project_id);

CREATE INDEX IF NOT EXISTS idx_send_logs_project_id ON send_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_created_at ON send_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent_at ON send_logs(sent_at);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_project_id ON webhook_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status_code ON webhook_logs(status_code);

CREATE INDEX IF NOT EXISTS idx_email_providers_type ON email_providers(type);
`;

/**
 * Partial unique index for caller-side idempotency.
 * Only rows with a non-null idempotency_key participate.
 *
 * D1/SQLite supports partial indexes via CREATE UNIQUE INDEX ... WHERE.
 * This must be a separate statement because it uses WHERE clause.
 */
export const PARTIAL_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_send_logs_idempotency ON send_logs(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL";

/**
 * Idempotent ADD COLUMN — checks table_info before altering.
 * Safe to call repeatedly; no-op if the column already exists.
 *
 * D1/SQLite does not support `ADD COLUMN IF NOT EXISTS`; running
 * `ALTER TABLE ... ADD COLUMN` against an existing column throws
 * `duplicate column name`. This helper reads PRAGMA table_info first.
 */
export async function ensureColumn(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const rows = await executeD1Query<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (rows.some((r) => r.name === column)) return;
  await executeD1Query(
    `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
  );
}

/**
 * Initialize the D1 schema. Safe to call multiple times (uses IF NOT EXISTS).
 *
 * 3-phase bootstrap:
 *   1. Run CREATE TABLE / CREATE INDEX statements (fresh-install path).
 *   2. ensureColumn() for each column added after initial release
 *      (upgrade path for existing databases).
 *   3. One-time backfill for rows predating the new columns.
 */
export async function initializeSchema(): Promise<void> {
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await executeD1Query(sql);
  }

  // Partial unique index (separate to avoid semicolon split issues)
  await executeD1Query(PARTIAL_INDEX_SQL);

  // Idempotent column additions for tables that existed before this feature.
  await ensureColumn(
    "projects",
    "provider_id",
    "TEXT REFERENCES email_providers(id)",
  );
  await ensureColumn("send_logs", "provider_id", "TEXT");
  await ensureColumn("send_logs", "provider_type", "TEXT");
  await ensureColumn("send_logs", "provider_message_id", "TEXT");

  // One-time backfill for rows predating the new columns.
  // Safe to run repeatedly — only updates NULLs.
  //
  // Every pre-migration send_logs row necessarily came from the legacy
  // env-var Resend path, so provider_type is 'legacy' regardless of
  // whether the send ultimately succeeded (resend_id NOT NULL) or
  // failed (resend_id NULL). Filtering on resend_id would strand
  // historical failed rows with NULL provider_type and break
  // "show me all legacy sends" auditing.
  await executeD1Query(
    `UPDATE send_logs SET provider_type = 'legacy' WHERE provider_type IS NULL`,
  );
  await executeD1Query(
    `UPDATE send_logs SET provider_message_id = resend_id
       WHERE provider_message_id IS NULL AND resend_id IS NOT NULL`,
  );
}
