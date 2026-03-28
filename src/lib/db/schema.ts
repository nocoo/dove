/**
 * D1 schema definitions and initialization.
 *
 * Tables: projects, recipients, templates, send_logs, webhook_logs
 *
 * All IDs are nanoid (21-char). All timestamps are UTC strings
 * in format YYYY-MM-DDTHH:mm:ss.sssZ (trailing Z only).
 */

import { executeD1Query } from "./d1-client";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  email_prefix TEXT NOT NULL,
  from_name TEXT NOT NULL,
  webhook_token TEXT NOT NULL UNIQUE,
  quota_daily INTEGER NOT NULL DEFAULT 100,
  quota_monthly INTEGER NOT NULL DEFAULT 1000,
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
 * Initialize the D1 schema. Safe to call multiple times (uses IF NOT EXISTS).
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
}
