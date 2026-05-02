-- Dove D1 Schema
-- All IDs are nanoid (21-char). All timestamps are UTC ISO-8601 strings.

--------------------------------------------------------------------------------
-- Email Providers
-- Stores credentials + configuration for outbound email providers (Resend, Cloudflare).
-- Each (type, domain) pair is unique so the same provider can be registered once per domain.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                -- 'resend' | 'cloudflare'
  domain TEXT NOT NULL,              -- sending domain, e.g. 'hexly.ai'
  config TEXT NOT NULL,              -- JSON string with provider-specific config
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, domain)
);

CREATE INDEX IF NOT EXISTS idx_email_providers_type ON email_providers(type);

--------------------------------------------------------------------------------
-- Projects
-- Each project represents an application/service that sends emails via Dove.
-- webhook_token is the Bearer token for API authentication.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  email_prefix TEXT NOT NULL,        -- e.g. 'noreply', 'hello'
  from_name TEXT NOT NULL,           -- display name in From header
  webhook_token TEXT NOT NULL UNIQUE,
  quota_daily INTEGER NOT NULL DEFAULT 100,
  quota_monthly INTEGER NOT NULL DEFAULT 1000,
  provider_id TEXT REFERENCES email_providers(id),  -- NULL = legacy env-var mode
  -- When 1, the webhook send endpoint skips the project-recipient whitelist
  -- check and accepts any RFC-valid email. Used for projects (e.g. ellie) that
  -- own their own user model and verify recipients themselves. Defaults to 0
  -- so adding a project never accidentally opens its allowlist.
  allow_unknown_recipients INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- For existing databases that pre-date `allow_unknown_recipients`, run
-- `migrations/2026-05-01-projects-allow-unknown-recipients.sql` (one-shot
-- ALTER TABLE; SQLite has no IF NOT EXISTS for columns). Fresh DBs already
-- include the column from the CREATE TABLE above.

CREATE INDEX IF NOT EXISTS idx_projects_webhook_token ON projects(webhook_token);

--------------------------------------------------------------------------------
-- Recipients
-- Whitelist of allowed recipients per project. Email is normalized to lowercase.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,               -- normalized: trim().toLowerCase()
  created_at TEXT NOT NULL,
  UNIQUE(project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_recipients_project_id ON recipients(project_id);

--------------------------------------------------------------------------------
-- Templates
-- Email templates with Markdown body and {{var}} substitution.
-- Variables are declared as a JSON array in the `variables` column.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                -- URL-friendly identifier, unique per project
  subject TEXT NOT NULL,             -- supports {{var}} substitution
  body_markdown TEXT NOT NULL,       -- Markdown with {{var}} substitution
  variables TEXT NOT NULL DEFAULT '[]',  -- JSON array of variable definitions
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_templates_project_id ON templates(project_id);

--------------------------------------------------------------------------------
-- Send Logs
-- Authoritative record of email send attempts. Written synchronously in webhook flow.
-- Status transitions: sending → sent | failed
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idempotency_key TEXT,              -- caller-provided deduplication key
  payload_hash TEXT,                 -- hash of request payload for idempotency
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  recipient_id TEXT REFERENCES recipients(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,             -- rendered subject at send time
  status TEXT NOT NULL,              -- 'sending' | 'sent' | 'failed'
  resend_id TEXT,                    -- DEPRECATED: use provider_message_id
  provider_id TEXT,                  -- FK to email_providers.id; NULL for legacy
  provider_type TEXT,                -- 'resend' | 'cloudflare' | 'legacy'
  provider_message_id TEXT,          -- provider-agnostic message ID
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT                       -- when status became 'sent'
);

CREATE INDEX IF NOT EXISTS idx_send_logs_project_id ON send_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_created_at ON send_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent_at ON send_logs(sent_at);

-- Partial unique index for caller-side idempotency.
-- Only rows with a non-null idempotency_key participate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_logs_idempotency
  ON send_logs(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

--------------------------------------------------------------------------------
-- Webhook Logs
-- Fire-and-forget observability logs. Written asynchronously.
-- For authoritative send history, use send_logs.
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- CF Email Idempotency (merged from worker-email)
-- Tracks in-flight and completed Cloudflare Email sends for idempotency.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cf_email_idempotency (
  id TEXT PRIMARY KEY,               -- same as send_logs.id
  status TEXT NOT NULL,              -- 'pending' | 'sent' | 'failed'
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cf_email_idempotency_status ON cf_email_idempotency(status);

--------------------------------------------------------------------------------
-- Rate Limit Locks
-- Atomic per-(project, email) send frequency limiting.
-- Each row represents an active cooldown. lock_token ensures ownership on release.
-- Expired rows are cleaned up lazily during acquire.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_locks (
  project_id TEXT NOT NULL,
  to_email TEXT NOT NULL,            -- normalized: trim().toLowerCase()
  blocked_until TEXT NOT NULL,       -- UTC ISO-8601 timestamp
  lock_token TEXT NOT NULL,          -- random token for ownership verification
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, to_email)
);
