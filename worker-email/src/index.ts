/**
 * Dove Cloudflare Email Worker.
 *
 * Endpoints:
 *   GET  /health — liveness probe
 *   POST /init   — bootstrap cf_email_idempotency table (X-API-Key required)
 *   POST /send   — send an email via CF Email Routing with D1-atomic idempotency
 *
 * Request shape for POST /send:
 *   Headers:
 *     X-API-Key:          required, matched against env.API_KEY
 *     X-Idempotency-Key:  required, used for D1 dedup
 *     X-Dry-Run:          optional "true" → skip env.EMAIL.send(), still mark row sent
 *   Body JSON:
 *     { from_name, from_address, to, subject, html }
 *
 * Idempotency is enforced by INSERT OR IGNORE into cf_email_idempotency
 * then reading meta.changes to distinguish "we claimed it" from
 * "someone else did". See docs/design/multi-provider-email.md.
 */

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

interface Env {
  EMAIL: SendEmail;
  IDEMPOTENCY_DB: D1Database;
  API_KEY: string;
}

interface SendRequest {
  from_name?: string;
  from_address?: string;
  to?: string;
  subject?: string;
  html?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/init") {
      return handleInit(request, env);
    }

    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * POST /init — create cf_email_idempotency table + index.
 * Idempotent: both statements use IF NOT EXISTS. Requires X-API-Key.
 */
async function handleInit(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await env.IDEMPOTENCY_DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS cf_email_idempotency (
         key TEXT PRIMARY KEY,
         message_id TEXT NOT NULL,
         status TEXT NOT NULL,
         error TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();

  await env.IDEMPOTENCY_DB
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_cf_email_idempotency_created_at
         ON cf_email_idempotency(created_at)`,
    )
    .run();

  return Response.json({ ok: true });
}

/**
 * POST /send — dispatch an email with atomic dedup.
 */
async function handleSend(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idempotencyKey = request.headers.get("X-Idempotency-Key");
  if (!idempotencyKey) {
    return Response.json(
      { error: "Missing X-Idempotency-Key header" },
      { status: 400 },
    );
  }

  const dryRun = request.headers.get("X-Dry-Run") === "true";

  let body: SendRequest;
  try {
    body = (await request.json()) as SendRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.from_address || !body.to || !body.subject || !body.html) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const messageId = `cf_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Atomic check-and-insert: INSERT OR IGNORE populates the row only if
  // the key is absent. meta.changes=1 ⇒ we claimed it; 0 ⇒ someone else did.
  const insertResult = await env.IDEMPOTENCY_DB
    .prepare(
      `INSERT OR IGNORE INTO cf_email_idempotency
         (key, message_id, status, created_at, updated_at)
       VALUES (?, ?, 'sending', ?, ?)`,
    )
    .bind(idempotencyKey, messageId, now, now)
    .run();

  let effectiveMessageId = messageId;

  if ((insertResult.meta.changes ?? 0) === 0) {
    const existing = await env.IDEMPOTENCY_DB
      .prepare(
        `SELECT message_id, status FROM cf_email_idempotency WHERE key = ?`,
      )
      .bind(idempotencyKey)
      .first<{ message_id: string; status: string }>();

    if (!existing) {
      // Row vanished between INSERT and SELECT — vanishingly rare.
      return Response.json(
        { error: "idempotency_state_unknown" },
        { status: 500 },
      );
    }

    if (existing.status === "sent") {
      return Response.json(
        { status: "sent", id: existing.message_id },
        { status: 409 },
      );
    }

    if (existing.status === "sending") {
      return Response.json(
        { status: "in_progress", error: "Request already in progress" },
        { status: 409 },
      );
    }

    // status === "failed" → attempt to reclaim for retry.
    const claim = await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET message_id = ?, status = 'sending', error = NULL, updated_at = ?
         WHERE key = ? AND status = 'failed'`,
      )
      .bind(messageId, now, idempotencyKey)
      .run();

    if ((claim.meta.changes ?? 0) === 0) {
      // Another retry grabbed it first.
      return Response.json(
        { status: "in_progress", error: "Retry contention" },
        { status: 409 },
      );
    }
    // Fall through — we now own the row with our fresh messageId.
    effectiveMessageId = messageId;
  }

  if (dryRun) {
    const dryRunId = `dry_run_${effectiveMessageId}`;
    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET message_id = ?, status = 'sent', updated_at = ?
         WHERE key = ?`,
      )
      .bind(dryRunId, new Date().toISOString(), idempotencyKey)
      .run();
    return Response.json({ status: "sent", id: dryRunId });
  }

  try {
    const msg = createMimeMessage();
    msg.setSender({ name: body.from_name ?? "", addr: body.from_address });
    msg.setRecipient(body.to);
    msg.setSubject(body.subject);
    msg.addMessage({ contentType: "text/html", data: body.html });

    const message = new EmailMessage(body.from_address, body.to, msg.asRaw());
    await env.EMAIL.send(message);

    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET status = 'sent', updated_at = ?
         WHERE key = ?`,
      )
      .bind(new Date().toISOString(), idempotencyKey)
      .run();

    return Response.json({ status: "sent", id: effectiveMessageId });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET status = 'failed', error = ?, updated_at = ?
         WHERE key = ?`,
      )
      .bind(errorMessage, new Date().toISOString(), idempotencyKey)
      .run();

    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
