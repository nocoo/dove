/**
 * Send log database operations (Cloudflare D1 native binding).
 *
 * Send logs are the authoritative record of email send attempts.
 * Written synchronously in the webhook send flow.
 */

import { query, queryOne, execute } from "./d1";
import { generateId } from "@/lib/id";

/**
 * Identifies which provider handled the send. `"legacy"` marks rows
 * written before multi-provider support landed (or NULL provider_id
 * on the project, falling back to env-var Resend).
 */
export type ProviderType = "resend" | "cloudflare" | "legacy";

export interface SendLog {
  id: string;
  project_id: string;
  idempotency_key: string | null;
  payload_hash: string | null;
  template_id: string | null;
  recipient_id: string | null;
  to_email: string;
  subject: string;
  status: "sending" | "sent" | "failed";
  /** DEPRECATED: retained for Resend backward compat. Prefer provider_message_id. */
  resend_id: string | null;
  /** FK to email_providers.id; NULL for legacy env-var path. */
  provider_id: string | null;
  /** Snapshot of provider type at send time. */
  provider_type: ProviderType | null;
  /** Provider-agnostic message id. Successor to resend_id. */
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * List send logs for a project, paginated, ordered by creation date descending.
 */
export async function listSendLogs(
  db: D1Database,
  projectId: string,
  options: {
    limit?: number | undefined;
    offset?: number | undefined;
    status?: string | undefined;
  } = {},
): Promise<SendLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (options.status) {
    return query<SendLog>(
      db,
      "SELECT * FROM send_logs WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [projectId, options.status, limit, offset],
    );
  }

  return query<SendLog>(
    db,
    "SELECT * FROM send_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [projectId, limit, offset],
  );
}

/**
 * List send logs across all projects, paginated.
 */
export async function listAllSendLogs(
  db: D1Database,
  options: {
    limit?: number | undefined;
    offset?: number | undefined;
    status?: string | undefined;
  } = {},
): Promise<SendLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (options.status) {
    return query<SendLog>(
      db,
      "SELECT * FROM send_logs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [options.status, limit, offset],
    );
  }

  return query<SendLog>(
    db,
    "SELECT * FROM send_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [limit, offset],
  );
}

/**
 * Get a single send log by ID.
 */
export async function getSendLog(
  db: D1Database,
  id: string,
): Promise<SendLog | null> {
  return queryOne<SendLog>(db, "SELECT * FROM send_logs WHERE id = ?", [id]);
}

/**
 * Find an existing send log by idempotency key within a project.
 */
export async function findByIdempotencyKey(
  db: D1Database,
  projectId: string,
  idempotencyKey: string,
): Promise<SendLog | null> {
  return queryOne<SendLog>(
    db,
    "SELECT * FROM send_logs WHERE project_id = ? AND idempotency_key = ?",
    [projectId, idempotencyKey],
  );
}

/**
 * Create a new send log with status "sending" (pre-log step).
 * The returned ID is used as the provider Idempotency-Key.
 *
 * provider_id/provider_type may be set here (snapshot) or filled in later
 * via updateSendLogProvider() once the webhook resolves which provider to use.
 */
export async function createSendLog(
  db: D1Database,
  data: {
    project_id: string;
    idempotency_key?: string | undefined;
    payload_hash?: string | undefined;
    template_id: string;
    recipient_id: string;
    to_email: string;
    subject: string;
    provider_id?: string | null | undefined;
    provider_type?: ProviderType | null | undefined;
  },
): Promise<SendLog> {
  const id = generateId();
  const now = new Date().toISOString();
  const provider_id = data.provider_id ?? null;
  const provider_type = data.provider_type ?? null;

  await execute(
    db,
    `INSERT INTO send_logs (id, project_id, idempotency_key, payload_hash, template_id, recipient_id, to_email, subject, status, provider_id, provider_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)`,
    [
      id,
      data.project_id,
      data.idempotency_key ?? null,
      data.payload_hash ?? null,
      data.template_id,
      data.recipient_id,
      data.to_email,
      data.subject,
      provider_id,
      provider_type,
      now,
    ],
  );

  return {
    id,
    project_id: data.project_id,
    idempotency_key: data.idempotency_key ?? null,
    payload_hash: data.payload_hash ?? null,
    template_id: data.template_id,
    recipient_id: data.recipient_id,
    to_email: data.to_email,
    subject: data.subject,
    status: "sending",
    resend_id: null,
    provider_id,
    provider_type,
    provider_message_id: null,
    error_message: null,
    created_at: now,
    sent_at: null,
  };
}

/**
 * Snapshot which provider handled this send. Typically called AFTER
 * createSendLog() but BEFORE provider.send() so the row is annotated
 * even if the send fails.
 */
export async function updateSendLogProvider(
  db: D1Database,
  id: string,
  data: { provider_id: string | null; provider_type: ProviderType },
): Promise<void> {
  await execute(
    db,
    `UPDATE send_logs SET provider_id = ?, provider_type = ? WHERE id = ?`,
    [data.provider_id, data.provider_type, id],
  );
}

/**
 * Reset a failed send log for retry: set status to "sending",
 * update to_email/subject with re-rendered values, clear error.
 */
export async function resetSendLogForRetry(
  db: D1Database,
  id: string,
  data: { to_email: string; subject: string },
): Promise<void> {
  await execute(
    db,
    `UPDATE send_logs SET status = 'sending', to_email = ?, subject = ?, error_message = NULL WHERE id = ?`,
    [data.to_email, data.subject, id],
  );
}

/**
 * Mark a send log as successfully sent.
 *
 * Always populates provider_message_id. Also dual-writes resend_id when
 * providerType ∈ {"resend","legacy"} so legacy SQL consumers (quota counters,
 * ad-hoc queries) keep working. For "cloudflare" sends, resend_id is left
 * NULL — readers should prefer provider_message_id with a resend_id fallback.
 */
export async function markSendLogSent(
  db: D1Database,
  id: string,
  data: { providerMessageId: string; providerType: ProviderType },
): Promise<void> {
  const now = new Date().toISOString();
  const writeResendId = data.providerType !== "cloudflare";

  if (writeResendId) {
    await execute(
      db,
      `UPDATE send_logs
         SET status = 'sent',
             resend_id = ?,
             provider_message_id = ?,
             sent_at = ?
       WHERE id = ?`,
      [data.providerMessageId, data.providerMessageId, now, id],
    );
  } else {
    await execute(
      db,
      `UPDATE send_logs
         SET status = 'sent',
             provider_message_id = ?,
             sent_at = ?
       WHERE id = ?`,
      [data.providerMessageId, now, id],
    );
  }
}

/**
 * Mark a send log as failed.
 */
export async function markSendLogFailed(
  db: D1Database,
  id: string,
  errorMessage: string,
): Promise<void> {
  await execute(
    db,
    "UPDATE send_logs SET status = 'failed', error_message = ? WHERE id = ?",
    [errorMessage, id],
  );
}

/**
 * Count sends for a project in the current UTC day.
 * Uses sent_at (actual delivery time) for accurate quota counting.
 */
export async function countDailySends(
  db: D1Database,
  projectId: string,
): Promise<number> {
  const result = await queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM send_logs
     WHERE project_id = ? AND status = 'sent'
     AND sent_at >= date('now') || 'T00:00:00.000Z'
     AND sent_at < date('now', '+1 day') || 'T00:00:00.000Z'`,
    [projectId],
  );
  return result?.count ?? 0;
}

/**
 * Count sends for a project in the current UTC month.
 * Uses sent_at (actual delivery time) for accurate quota counting.
 */
export async function countMonthlySends(
  db: D1Database,
  projectId: string,
): Promise<number> {
  const result = await queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM send_logs
     WHERE project_id = ? AND status = 'sent'
     AND sent_at >= strftime('%Y-%m-01', 'now') || 'T00:00:00.000Z'
     AND sent_at < date(strftime('%Y-%m-01', 'now'), '+1 month') || 'T00:00:00.000Z'`,
    [projectId],
  );
  return result?.count ?? 0;
}

export interface ProviderSendStats {
  total: number;
  sent: number;
  failed: number;
}

export async function getProviderSendStats(
  db: D1Database,
  providerId: string,
  limit = 20,
): Promise<ProviderSendStats> {
  const rows = await query<{ status: string; count: number }>(
    db,
    `SELECT status, COUNT(*) as count FROM send_logs
     WHERE provider_id = ? AND id IN (
       SELECT id FROM send_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?
     )
     GROUP BY status`,
    [providerId, providerId, limit],
  );

  let sent = 0;
  let failed = 0;
  let total = 0;
  for (const row of rows) {
    total += row.count;
    if (row.status === "sent") sent = row.count;
    if (row.status === "failed") failed = row.count;
  }
  return { total, sent, failed };
}
