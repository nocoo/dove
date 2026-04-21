import type { EmailProviderRecord } from "../db/email-providers";
import type { Env } from "../../env";

export type ProviderType = "resend" | "cloudflare";

export interface SendParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}

export interface SendResult {
  id: string;
}

export interface EmailProvider {
  readonly type: ProviderType;
  send(params: SendParams): Promise<SendResult>;
  supportsDryRun(): boolean;
  setDryRun(enabled: boolean): void;
}

export type ProviderConfig =
  | { type: "resend"; api_key: string }
  | { type: "cloudflare"; worker_url: string; api_key: string };

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

export async function createLegacyProvider(env: Env): Promise<EmailProvider> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }
  const { ResendProvider } = await import("./providers/resend");
  return new ResendProvider(apiKey);
}

export function getProviderDomain(
  provider: EmailProviderRecord | null,
  env?: Env,
): string {
  if (provider) {
    return provider.domain;
  }
  const domain = env?.RESEND_FROM_DOMAIN;
  if (!domain) {
    throw new Error("RESEND_FROM_DOMAIN not configured");
  }
  return domain;
}
