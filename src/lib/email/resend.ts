/**
 * Resend API client.
 *
 * Direct fetch() call to https://api.resend.com/emails.
 * Two-layer idempotency:
 *   Layer 1 — Caller dedup via idempotency_key in send_logs (handled by webhook route)
 *   Layer 2 — Resend dedup via Idempotency-Key header (this client)
 */

export interface SendEmailParams {
  /** e.g. "Backy Alerts <noreply@mail.example.com>" */
  from: string;
  /** Recipient email */
  to: string;
  /** Rendered subject */
  subject: string;
  /** Rendered HTML */
  html: string;
  /** Unique key for Resend dedup (= send_log.id) */
  idempotencyKey: string;
}

export interface SendEmailResult {
  /** Resend message UUID */
  id: string;
}

/** Max retry attempts for transient Resend errors (5xx). */
const RESEND_MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff. */
const RESEND_RETRY_BASE_MS = 500;

/**
 * Send an email via the Resend API.
 *
 * Retry strategy:
 * - 3 attempts with exponential backoff (500ms → 1000ms → 2000ms) on 5xx only
 * - No retry on 4xx (client errors are not transient)
 * - On 409 (concurrent_idempotent_requests): wait 1s and retry
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  // Dry-run mode: validate params but skip Resend API call.
  // Used by L2/L3 E2E tests to exercise the full send pipeline
  // (auth → dedup → quota → render → log) without hitting the real API.
  if (process.env.RESEND_DRY_RUN === "true") {
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
      console.warn(`Resend retry ${attempt}/${RESEND_MAX_RETRIES} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": params.idempotencyKey,
        },
        body,
      });
    } catch (err) {
      // Network error — retryable
      if (attempt < RESEND_MAX_RETRIES) {
        console.warn("Resend network error:", err);
        lastError = err instanceof Error ? err : new Error("Resend network error");
        continue;
      }
      throw err;
    }

    // 409 = concurrent_idempotent_requests — wait and retry
    if (response.status === 409) {
      if (attempt < RESEND_MAX_RETRIES) {
        console.warn("Resend 409 concurrent_idempotent_requests, retrying after 1s");
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

  // All retries exhausted
  throw lastError ?? new Error("Resend API failed after all retries");
}
