export type EmailProviderType = "resend" | "cloudflare";

export interface EmailProviderRecord {
  id: string;
  name: string;
  type: EmailProviderType;
  domain: string;
  config: string;
  created_at: string;
  updated_at: string;
}
