/**
 * Send log database operations.
 *
 * Send logs are the authoritative record of email send attempts.
 * Written synchronously in the webhook send flow.
 */

import { executeD1Query } from "./d1-client";
import { generateId } from "@/lib/id";

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
  resend_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * List send logs for a project, paginated, ordered by creation date descending.
 */
export async function listSendLogs(
  projectId: string,
  options: { limit?: number; offset?: number; status?: string } = {},
): Promise<SendLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (options.status) {
    return executeD1Query<SendLog>(
      "SELECT * FROM send_logs WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [projectId, options.status, limit, offset],
    );
  }

  return executeD1Query<SendLog>(
    "SELECT * FROM send_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [projectId, limit, offset],
  );
}

/**
 * List send logs across all projects, paginated.
 */
export async function listAllSendLogs(
  options: { limit?: number; offset?: number; status?: string } = {},
): Promise<SendLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (options.status) {
    return executeD1Query<SendLog>(
      "SELECT * FROM send_logs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [options.status, limit, offset],
    );
  }

  return executeD1Query<SendLog>(
    "SELECT * FROM send_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [limit, offset],
  );
}

/**
 * Get a single send log by ID.
 */
export async function getSendLog(id: string): Promise<SendLog | undefined> {
  const rows = await executeD1Query<SendLog>(
    "SELECT * FROM send_logs WHERE id = ?",
    [id],
  );
  return rows[0];
}

/**
 * Find an existing send log by idempotency key within a project.
 */
export async function findByIdempotencyKey(
  projectId: string,
  idempotencyKey: string,
): Promise<SendLog | undefined> {
  const rows = await executeD1Query<SendLog>(
    "SELECT * FROM send_logs WHERE project_id = ? AND idempotency_key = ?",
    [projectId, idempotencyKey],
  );
  return rows[0];
}

/**
 * Create a new send log with status "sending" (pre-log step).
 * The returned ID is used as the Resend Idempotency-Key.
 */
export async function createSendLog(data: {
  project_id: string;
  idempotency_key?: string;
  payload_hash?: string;
  template_id: string;
  recipient_id: string;
  to_email: string;
  subject: string;
}): Promise<SendLog> {
  const id = generateId();
  const now = new Date().toISOString();

  await executeD1Query(
    `INSERT INTO send_logs (id, project_id, idempotency_key, payload_hash, template_id, recipient_id, to_email, subject, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?)`,
    [
      id,
      data.project_id,
      data.idempotency_key ?? null,
      data.payload_hash ?? null,
      data.template_id,
      data.recipient_id,
      data.to_email,
      data.subject,
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
    error_message: null,
    created_at: now,
    sent_at: null,
  };
}

/**
 * Reset a failed send log for retry: set status to "sending",
 * update to_email/subject with re-rendered values, clear error.
 */
export async function resetSendLogForRetry(
  id: string,
  data: { to_email: string; subject: string },
): Promise<void> {
  await executeD1Query(
    `UPDATE send_logs SET status = 'sending', to_email = ?, subject = ?, error_message = NULL WHERE id = ?`,
    [data.to_email, data.subject, id],
  );
}

/**
 * Mark a send log as successfully sent.
 */
export async function markSendLogSent(
  id: string,
  resendId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await executeD1Query(
    "UPDATE send_logs SET status = 'sent', resend_id = ?, sent_at = ? WHERE id = ?",
    [resendId, now, id],
  );
}

/**
 * Mark a send log as failed.
 */
export async function markSendLogFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  await executeD1Query(
    "UPDATE send_logs SET status = 'failed', error_message = ? WHERE id = ?",
    [errorMessage, id],
  );
}

/**
 * Count sends for a project in the current UTC day.
 * Uses sent_at (actual delivery time) for accurate quota counting.
 */
export async function countDailySends(projectId: string): Promise<number> {
  const rows = await executeD1Query<{ count: number }>(
    `SELECT COUNT(*) as count FROM send_logs
     WHERE project_id = ? AND status = 'sent'
     AND sent_at >= date('now') || 'T00:00:00.000Z'
     AND sent_at < date('now', '+1 day') || 'T00:00:00.000Z'`,
    [projectId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Count sends for a project in the current UTC month.
 * Uses sent_at (actual delivery time) for accurate quota counting.
 */
export async function countMonthlySends(projectId: string): Promise<number> {
  const rows = await executeD1Query<{ count: number }>(
    `SELECT COUNT(*) as count FROM send_logs
     WHERE project_id = ? AND status = 'sent'
     AND sent_at >= strftime('%Y-%m-01', 'now') || 'T00:00:00.000Z'
     AND sent_at < date(strftime('%Y-%m-01', 'now'), '+1 month') || 'T00:00:00.000Z'`,
    [projectId],
  );
  return rows[0]?.count ?? 0;
}
