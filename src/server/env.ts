/// <reference types="@cloudflare/workers-types" />

export interface Env {
	DB: D1Database;

	EMAIL: SendEmail;

	// Secrets (set via `wrangler secret put`)
	RESEND_API_KEY: string;
	RESEND_FROM_DOMAIN?: string;

	// Cloudflare Access
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;

	// Dev mode (set in .env.local, bypasses auth on local dev)
	DEV_MODE?: string;

	// Dry-run toggles (E2E)
	EMAIL_DRY_RUN?: string;
	RESEND_DRY_RUN?: string;
}
