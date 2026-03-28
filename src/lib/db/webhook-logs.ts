/**
 * Webhook log database operations.
 *
 * Webhook logs are fire-and-forget observability logs.
 * Written asynchronously — may be lost under D1 failures.
 * For authoritative send history, use send_logs.
 */

import { executeD1Query } from "./d1-client";
import { generateId } from "@/lib/id";

export interface WebhookLog {
  id: string;
  project_id: string;
  method: string;
  path: string;
  status_code: number;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * List webhook logs for a project, paginated, ordered by creation date descending.
 */
export async function listWebhookLogs(
  projectId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<WebhookLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return executeD1Query<WebhookLog>(
    "SELECT * FROM webhook_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [projectId, limit, offset],
  );
}

/**
 * List webhook logs across all projects, paginated.
 */
export async function listAllWebhookLogs(
  options: { limit?: number; offset?: number } = {},
): Promise<WebhookLog[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return executeD1Query<WebhookLog>(
    "SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [limit, offset],
  );
}

/**
 * Create a webhook log entry.
 *
 * This is fire-and-forget: callers should use `void createWebhookLog(...)`
 * and not await or catch errors. Logs may be lost under transient failures.
 */
export async function createWebhookLog(data: {
  project_id: string;
  method: string;
  path: string;
  status_code: number;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
  ip?: string;
  user_agent?: string;
}): Promise<void> {
  const id = generateId();
  const now = new Date().toISOString();

  await executeD1Query(
    `INSERT INTO webhook_logs (id, project_id, method, path, status_code, error_code, error_message, duration_ms, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.project_id,
      data.method,
      data.path,
      data.status_code,
      data.error_code ?? null,
      data.error_message ?? null,
      data.duration_ms ?? null,
      data.ip ?? null,
      data.user_agent ?? null,
      now,
    ],
  );
}
