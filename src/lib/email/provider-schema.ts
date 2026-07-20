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

export const CloudflareConfigSchema = z.object({});

/**
 * Validate a config object against its declared provider type.
 * Returns the parsed config or a ZodError on failure.
 */
export function parseConfigForType(type: "resend" | "cloudflare", config: unknown) {
	const schema = type === "resend" ? ResendConfigSchema : CloudflareConfigSchema;
	return schema.safeParse(config);
}

/**
 * Hostname regex (RFC 1123-ish). Accepts labels of [a-z0-9-] separated
 * by dots, no leading/trailing hyphen, each label ≤63 chars, total
 * ≤253 chars (enforced by the caller via .max()). Lowercase-only by the
 * time this runs — call DomainSchema which lowercases+trims first.
 */
const HOSTNAME_RE =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

/**
 * Zod schema for a sender domain. Normalizes case and whitespace before
 * validating so `Mail.Example.com ` and `mail.example.com` collapse to
 * the same canonical form. Prevents uniqueness bypasses on (type, domain)
 * and keeps the constructed sender address free of stray whitespace.
 *
 * Rejects: bare TLDs ("com"), underscores, embedded spaces, protocol
 * prefixes ("https://mail.x.com"), IPs, and trailing dots.
 */
export const DomainSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(253)
	.regex(HOSTNAME_RE, "must be a valid hostname (e.g. mail.example.com)");
