-- Add `allow_unknown_recipients` to existing projects tables.
--
-- Run only on databases created BEFORE this column was added to schema.sql.
-- Fresh databases already include the column.
--
-- Apply with:
--   wrangler d1 execute dove-db --file=migrations/2026-05-01-projects-allow-unknown-recipients.sql
--
-- Then enable for the ellie project (and ONLY ellie):
--   UPDATE projects SET allow_unknown_recipients = 1 WHERE id = '<ellie-project-id>';

ALTER TABLE projects
  ADD COLUMN allow_unknown_recipients INTEGER NOT NULL DEFAULT 0;
