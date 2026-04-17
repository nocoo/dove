/**
 * @deprecated Use the provider layer in `src/lib/email/provider.ts` +
 * `src/lib/email/providers/resend.ts` instead.
 *
 * Kept as a thin wrapper around ResendProvider so legacy call sites in
 * the webhook route keep working during the C3 → C5 transition.
 */

import { ResendProvider } from "./providers/resend";

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

/**
 * Send an email via the Resend API using the legacy RESEND_API_KEY env var.
 */
export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const provider = new ResendProvider(apiKey);
  return provider.send(params);
}
