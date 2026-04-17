/**
 * ResendProvider — implements EmailProvider via api.resend.com/emails.
 *
 * Layer 2 idempotency: Resend honors the Idempotency-Key header for 24h.
 */

import type { EmailProvider, SendParams, SendResult } from "../provider";

const RESEND_MAX_RETRIES = 3;
const RESEND_RETRY_BASE_MS = 500;

export class ResendProvider implements EmailProvider {
  readonly type = "resend" as const;
  private dryRun = false;

  constructor(private readonly apiKey: string) {}

  supportsDryRun(): boolean {
    return true;
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  async send(params: SendParams): Promise<SendResult> {
    // Dry-run: validate params but skip the real API call.
    if (this.dryRun || process.env.RESEND_DRY_RUN === "true") {
      return { id: `dry_run_${crypto.randomUUID()}` };
    }

    const body = JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RESEND_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RESEND_RETRY_BASE_MS * 2 ** (attempt - 1);
        console.warn(
          `Resend retry ${attempt}/${RESEND_MAX_RETRIES} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": params.idempotencyKey,
          },
          body,
        });
      } catch (err) {
        if (attempt < RESEND_MAX_RETRIES) {
          console.warn("Resend network error:", err);
          lastError =
            err instanceof Error ? err : new Error("Resend network error");
          continue;
        }
        throw err;
      }

      // 409 = concurrent_idempotent_requests — wait and retry
      if (response.status === 409) {
        if (attempt < RESEND_MAX_RETRIES) {
          console.warn(
            "Resend 409 concurrent_idempotent_requests, retrying after 1s",
          );
          await new Promise((r) => setTimeout(r, 1000));
          lastError = new Error("Resend concurrent request conflict");
          continue;
        }
      }

      // 5xx — retryable
      if (response.status >= 500) {
        const errorText = await response.text();
        if (attempt < RESEND_MAX_RETRIES) {
          console.warn("Resend 5xx:", response.status, errorText);
          lastError = new Error(`Resend API error: ${response.status}`);
          continue;
        }
        throw new Error(`Resend API error: ${response.status} ${errorText}`);
      }

      // 4xx — not retryable
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as { id: string };
      return { id: data.id };
    }

    throw lastError ?? new Error("Resend API failed after all retries");
  }
}
