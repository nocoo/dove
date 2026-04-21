import type { EmailProvider, SendParams, SendResult } from "../provider";

declare const EmailMessage: {
  new (from: string, to: string, raw: ReadableStream): { from: string; to: string };
};

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
      const existing = await this.db
        .prepare("SELECT status FROM cf_email_idempotency WHERE id = ?")
        .bind(key)
        .first<{ status: string }>();

      if (existing?.status === "sent") return { id: key };
      if (existing?.status === "pending") throw new Error("Concurrent send for same idempotency key");

      await this.db
        .prepare("INSERT INTO cf_email_idempotency (id, status, created_at) VALUES (?, 'pending', ?)")
        .bind(key, new Date().toISOString())
        .run();
    }

    const fromAddr = extractAddress(params.from);
    const fromName = extractName(params.from);

    const boundary = "----cf" + crypto.randomUUID().replace(/-/g, "");
    const rawEmail = [
      `From: ${fromName ? `${fromName} <${fromAddr}>` : fromAddr}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      params.html,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    try {
      const msg = new EmailMessage(fromAddr, params.to, new Blob([rawEmail]).stream());
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
}

export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match?.[1]?.trim() ?? "";
}

export function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? from.trim();
}
