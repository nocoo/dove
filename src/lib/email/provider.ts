/**
 * Provider layer — pluggable email backends.
 *
 * Every provider implements a small uniform interface so the webhook
 * route can stay provider-agnostic. Idempotency is layered:
 *
 *   Layer 1 (authoritative): send_logs UNIQUE(project_id, idempotency_key)
 *     enforced by the Next.js webhook route. Caller retries with the same
 *     idempotency_key return the cached send_log without invoking the
 *     provider.
 *
 *   Layer 2 (best-effort): Provider-specific dedup (Resend Idempotency-Key
 *     header / Cloudflare D1 UNIQUE constraint). Catches cases where Next.js
 *     retries after an ambiguous failure.
 */

import type { EmailProviderRecord } from "@/lib/db/email-providers";

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

/**
 * Config shapes stored as JSON in email_providers.config.
 * Parse with parseProviderConfig() before passing to createProvider().
 */
export type ProviderConfig =
  | { type: "resend"; api_key: string }
  | { type: "cloudflare"; worker_url: string; api_key: string };

/**
 * Parse email_providers.config JSON and shape-check it.
 * Throws on malformed input so corruption surfaces loudly.
 */
export function parseProviderConfig(record: EmailProviderRecord): ProviderConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(record.config);
  } catch {
    throw new Error(`Invalid provider config JSON for ${record.id}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid provider config for ${record.id}`);
  }
  const obj = raw as Record<string, unknown>;

  if (record.type === "resend") {
    const apiKey = obj["api_key"];
    if (typeof apiKey !== "string" || !apiKey) {
      throw new Error(`Resend provider ${record.id} missing api_key`);
    }
    return { type: "resend", api_key: apiKey };
  }
  if (record.type === "cloudflare") {
    const workerUrl = obj["worker_url"];
    const apiKey = obj["api_key"];
    if (typeof workerUrl !== "string" || !workerUrl) {
      throw new Error(`Cloudflare provider ${record.id} missing worker_url`);
    }
    if (typeof apiKey !== "string" || !apiKey) {
      throw new Error(`Cloudflare provider ${record.id} missing api_key`);
    }
    return { type: "cloudflare", worker_url: workerUrl, api_key: apiKey };
  }
  throw new Error(`Unknown provider type: ${record.type as string}`);
}

/**
 * Build a provider instance from a parsed config.
 */
export async function createProvider(
  config: ProviderConfig,
): Promise<EmailProvider> {
  switch (config.type) {
    case "resend": {
      const { ResendProvider } = await import("./providers/resend");
      return new ResendProvider(config.api_key);
    }
    case "cloudflare": {
      const { CloudflareProvider } = await import("./providers/cloudflare");
      return new CloudflareProvider(config.worker_url, config.api_key);
    }
    default:
      throw new Error(
        `Unknown provider type: ${(config as { type: string }).type}`,
      );
  }
}

/**
 * Build a provider from legacy env vars (used when a project has
 * provider_id = NULL). Backward-compat path for existing deployments.
 */
export async function createLegacyProvider(): Promise<EmailProvider> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const { ResendProvider } = await import("./providers/resend");
  return new ResendProvider(apiKey);
}

/**
 * Resolve the sending domain for a provider.
 * For legacy mode, falls back to RESEND_FROM_DOMAIN env var.
 */
export function getProviderDomain(
  provider: EmailProviderRecord | null,
): string {
  if (provider) {
    return provider.domain;
  }
  const domain = process.env.RESEND_FROM_DOMAIN;
  if (!domain) {
    throw new Error("RESEND_FROM_DOMAIN not configured");
  }
  return domain;
}

/**
 * Provider-agnostic dry-run toggle.
 *
 * EMAIL_DRY_RUN is the canonical, provider-agnostic switch. RESEND_DRY_RUN
 * is a legacy alias kept for backward-compat with existing deploys that
 * only ever ran through Resend — it must only affect Resend/legacy sends,
 * never Cloudflare. Callers that want to gate on the legacy alias should
 * check the `providerType` argument.
 */
export function isDryRunEnabled(
  providerType?: ProviderType | "legacy",
): boolean {
  if (process.env.EMAIL_DRY_RUN === "true") return true;
  if (process.env.RESEND_DRY_RUN === "true") {
    // Legacy alias: Resend/legacy only. Cloudflare must not be silently
    // forced into dry-run by an env var that predates multi-provider.
    return providerType === undefined || providerType !== "cloudflare";
  }
  return false;
}
