/**
 * Zod schemas for provider config, discriminated by `type`.
 *
 * Mirrors the runtime shape enforced by parseProviderConfig() in
 * src/lib/email/provider.ts so invalid configs are rejected at the API
 * boundary instead of surfacing as 500s at send time.
 */

import { z } from "zod/v4";

export const ResendConfigSchema = z.object({
  api_key: z.string().min(1),
});

export const CloudflareConfigSchema = z.object({
  api_key: z.string().min(1),
  worker_url: z.string().url(),
});

/**
 * Validate a config object against its declared provider type.
 * Returns the parsed config or a ZodError on failure.
 */
export function parseConfigForType(
  type: "resend" | "cloudflare",
  config: unknown,
) {
  const schema =
    type === "resend" ? ResendConfigSchema : CloudflareConfigSchema;
  return schema.safeParse(config);
}
