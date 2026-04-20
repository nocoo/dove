/**
 * Cloudflare Worker environment bindings.
 *
 * All bindings are defined in wrangler.toml and available via `c.env` in Hono.
 */

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace (sessions)
  KV: KVNamespace;

  // Email binding
  EMAIL: SendEmail;

  // Secrets (set via `wrangler secret put`)
  AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ALLOWED_EMAILS: string; // comma-separated whitelist
}
