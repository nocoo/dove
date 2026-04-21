import { Hono } from "hono";
import type { Env } from "../env";

const dbInit = new Hono<{ Bindings: Env }>();

const SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_email_providers_type ON email_providers(type);

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
CREATE INDEX IF NOT EXISTS idx_projects_webhook_token ON projects(webhook_token);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, email)
);
CREATE INDEX IF NOT EXISTS idx_recipients_project_id ON recipients(project_id);

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
CREATE INDEX IF NOT EXISTS idx_templates_project_id ON templates(project_id);

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
CREATE INDEX IF NOT EXISTS idx_send_logs_project_id ON send_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_created_at ON send_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent_at ON send_logs(sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_logs_idempotency
  ON send_logs(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS idx_webhook_logs_project_id ON webhook_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status_code ON webhook_logs(status_code);

CREATE TABLE IF NOT EXISTS cf_email_idempotency (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cf_email_idempotency_status ON cf_email_idempotency(status);
`;

dbInit.post("/", async (c) => {
  const host = c.req.header("host") ?? new URL(c.req.url).host;
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");

  if (!isLocal) {
    return c.json({ error: "Only available in local development" }, 403);
  }

  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    await c.env.DB.prepare(stmt).run();
  }

  return c.json({ ok: true, statements: statements.length });
});

export { dbInit };
