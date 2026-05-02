-- Add rate_limit_locks table for per-address send frequency limiting.
--
-- Each row represents an active cooldown for a (project, email) pair.
-- The lock_token ensures only the request that acquired the lock can release it.
--
-- Apply with:
--   wrangler d1 execute dove-db --file=migrations/2026-05-02-rate-limit-locks.sql

CREATE TABLE IF NOT EXISTS rate_limit_locks (
  project_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  blocked_until TEXT NOT NULL,
  lock_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, to_email)
);
