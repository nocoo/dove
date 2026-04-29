/**
 * Provider layer types — the runtime/factory functions live in
 * `src/server/lib/email/provider.ts`. This file exists only to export
 * the `EmailProvider`, `SendParams`, `SendResult`, and `ProviderType`
 * shapes consumed by the concrete provider implementations in
 * `src/lib/email/providers/{resend,cloudflare}.ts`. Keeping the types
 * here (rather than in the server module) preserves layering: the
 * concrete providers don't reach into `src/server/`.
 */

export type ProviderType = "resend" | "cloudflare";

export interface SendParams {
  /** Full "Name <email@domain>" format. */
  from: string;
  /** Recipient email. */
  to: string;
  /** Rendered subject. */
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** REQUIRED. Stable across retries; provider uses for Layer 2 dedup. */
  idempotencyKey: string;
}

export interface SendResult {
  /** Provider-specific message ID. */
  id: string;
}

export interface EmailProvider {
  readonly type: ProviderType;

  /**
   * Send an email through this provider. Throws on failure after retries.
   */
  send(params: SendParams): Promise<SendResult>;

  /**
   * Whether this provider supports dry-run validation without sending.
   */
  supportsDryRun(): boolean;

  /**
   * Enable/disable dry-run. When enabled, `send()` validates but skips the
   * real call and returns a synthetic id.
   */
  setDryRun(enabled: boolean): void;
}
