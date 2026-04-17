/**
 * CloudflareProvider — implements EmailProvider via the CF Email Worker.
 *
 * Layer 2 idempotency: the Worker uses a D1 UNIQUE constraint keyed on
 * X-Idempotency-Key for atomic check-and-insert (see worker-email/).
 *
 * Worker responses:
 *   200 { id }                             — newly sent
 *   409 { status: "sent", id }             — cached success
 *   409 { status: "in_progress" }          — concurrent send; retry
 *   5xx { error }                          — transient; retry
 *   4xx { error }                          — client error; no retry
 */

import type { EmailProvider, SendParams, SendResult } from "../provider";

const CF_MAX_RETRIES = 3;
const CF_RETRY_BASE_MS = 500;
const CF_IN_PROGRESS_WAIT_MS = 1000;

interface CfSendResponse {
  status?: "sent" | "in_progress";
  id?: string;
  error?: string;
}

export class CloudflareProvider implements EmailProvider {
  readonly type = "cloudflare" as const;
  private dryRun = false;

  constructor(
    private readonly workerUrl: string,
    private readonly apiKey: string,
  ) {}

  supportsDryRun(): boolean {
    return true;
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  async send(params: SendParams): Promise<SendResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= CF_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = CF_RETRY_BASE_MS * 2 ** (attempt - 1);
        console.warn(
          `CF Worker retry ${attempt}/${CF_MAX_RETRIES} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      let response: Response;
      try {
        response = await fetch(`${this.workerUrl}/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
            "X-Idempotency-Key": params.idempotencyKey,
            ...(this.dryRun ? { "X-Dry-Run": "true" } : {}),
          },
          body: JSON.stringify({
            from_name: extractName(params.from),
            from_address: extractAddress(params.from),
            to: params.to,
            subject: params.subject,
            html: params.html,
          }),
        });
      } catch (err) {
        if (attempt < CF_MAX_RETRIES) {
          console.warn("CF Worker network error:", err);
          lastError =
            err instanceof Error ? err : new Error("CF Worker network error");
          continue;
        }
        throw err;
      }

      let data: CfSendResponse;
      try {
        data = (await response.json()) as CfSendResponse;
      } catch {
        if (attempt < CF_MAX_RETRIES && response.status >= 500) {
          lastError = new Error(
            `CF Worker returned non-JSON ${response.status}`,
          );
          continue;
        }
        throw new Error(
          `CF Worker returned non-JSON response: ${response.status}`,
        );
      }

      // 200 — newly sent
      if (response.ok) {
        if (!data.id) {
          throw new Error("CF Worker returned 200 without id");
        }
        return { id: data.id };
      }

      // 409 — discriminate by `status`
      if (response.status === 409) {
        if (data.status === "sent" && data.id) {
          return { id: data.id };
        }
        if (data.status === "in_progress") {
          if (attempt < CF_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, CF_IN_PROGRESS_WAIT_MS));
            lastError = new Error("CF Worker concurrent request");
            continue;
          }
          throw new Error("CF Worker concurrent request did not resolve");
        }
        throw new Error(
          `CF Worker 409 without valid status: ${data.error ?? "unknown"}`,
        );
      }

      // 5xx — retryable
      if (response.status >= 500) {
        if (attempt < CF_MAX_RETRIES) {
          lastError = new Error(`CF Worker error: ${response.status}`);
          continue;
        }
        throw new Error(
          `CF Worker error: ${response.status} ${data.error ?? ""}`,
        );
      }

      // 4xx — not retryable
      throw new Error(
        `CF Worker error: ${response.status} ${data.error ?? ""}`,
      );
    }

    throw lastError ?? new Error("CF Worker failed after all retries");
  }
}

/**
 * Parse "Name <email@domain>" → "Name". Returns "" when no display name.
 */
export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match?.[1]?.trim() ?? "";
}

/**
 * Parse "Name <email@domain>" → "email@domain". Falls back to full input.
 */
export function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? from.trim();
}
