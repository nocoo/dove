import type { EmailProvider, SendParams, SendResult } from "../provider";

interface EmailMessageConstructor {
  new (from: string, to: string, raw: ReadableStream): { from: string; to: string };
}

export class CloudflareProvider implements EmailProvider {
  readonly type = "cloudflare" as const;

  constructor(
    private readonly emailBinding: SendEmail,
    private readonly db?: D1Database,
  ) {}

  supportsDryRun(): boolean {
    return false;
  }

  setDryRun(): void {}

  async send(params: SendParams): Promise<SendResult> {
    const key = params.idempotencyKey;

    if (this.db && key) {
      await this.acquireIdempotencySlot(key);
    }

    try {
      const msg = createMimeMessage(params);
      await this.emailBinding.send(msg);
    } catch (error) {
      if (this.db && key) {
        await this.db
          .prepare("UPDATE cf_email_idempotency SET status = 'failed' WHERE id = ?")
          .bind(key)
          .run();
      }
      throw error;
    }

    if (this.db && key) {
      await this.db
        .prepare("UPDATE cf_email_idempotency SET status = 'sent', completed_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), key)
        .run();
    }

    return { id: key };
  }

  private async acquireIdempotencySlot(key: string): Promise<void> {
    const db = this.db as D1Database;

    // Atomic check-and-insert: INSERT OR IGNORE dedupes on PK.
    // If a row already exists, changes = 0 and we fall through to SELECT.
    const result = await db
      .prepare("INSERT OR IGNORE INTO cf_email_idempotency (id, status, created_at) VALUES (?, 'pending', ?)")
      .bind(key, new Date().toISOString())
      .run();

    if (result.meta.changes > 0) return; // fresh slot acquired

    const existing = await db
      .prepare("SELECT status FROM cf_email_idempotency WHERE id = ?")
      .bind(key)
      .first<{ status: string }>();

    if (!existing) return; // race: row disappeared, treat as fresh

    if (existing.status === "sent") throw new IdempotentSendResult(key);
    if (existing.status === "pending") throw new Error("Concurrent send for same idempotency key");

    // status === 'failed': reclaim the slot for retry
    const reclaim = await db
      .prepare("UPDATE cf_email_idempotency SET status = 'pending', created_at = ?, completed_at = NULL WHERE id = ? AND status = 'failed'")
      .bind(new Date().toISOString(), key)
      .run();

    if (reclaim.meta.changes === 0) {
      throw new Error("Concurrent send for same idempotency key");
    }
  }
}

/**
 * Thrown when Layer 2 idempotency detects a duplicate send that already
 * succeeded. The caller should treat this as a successful no-op.
 */
export class IdempotentSendResult extends Error {
  readonly idempotencyKey: string;
  constructor(key: string) {
    super("Idempotent duplicate: already sent");
    this.name = "IdempotentSendResult";
    this.idempotencyKey = key;
  }
}

function createMimeMessage(params: SendParams): { from: string; to: string } {
  const fromAddr = extractAddress(params.from);
  const fromName = extractName(params.from);

  const boundary = "----cf" + crypto.randomUUID().replace(/-/g, "");
  const rawEmail = [
    `From: ${fromName ? `${encodeRfc2047(fromName)} <${fromAddr}>` : fromAddr}`,
    `To: ${params.to}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    params.html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  const EM = (globalThis as Record<string, unknown>).EmailMessage as EmailMessageConstructor | undefined;
  if (!EM) {
    throw new Error("Cloudflare EmailMessage API not available (email sending not supported in local dev)");
  }
  return new EM(fromAddr, params.to, new Blob([rawEmail]).stream());
}

/** RFC 2047 encode a header value if it contains non-ASCII characters. */
function encodeRfc2047(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const encoded = new TextEncoder().encode(value);
  const b64 = btoa(String.fromCharCode(...encoded));
  return `=?UTF-8?B?${b64}?=`;
}

export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match?.[1]?.trim() ?? "";
}

export function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? from.trim();
}
