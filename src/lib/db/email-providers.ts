/**
 * Email provider database operations.
 *
 * Stores credentials + configuration for outbound email providers
 * (Resend, Cloudflare). Each (type, domain) pair is unique so the
 * same provider can be registered once per sending domain.
 */

import { executeD1Query } from "./d1-client";
import { generateId } from "@/lib/id";

export type EmailProviderType = "resend" | "cloudflare";

export interface EmailProviderRecord {
  id: string;
  name: string;
  type: EmailProviderType;
  domain: string;
  /** JSON string; shape depends on type (api_key, worker_url, etc.) */
  config: string;
  created_at: string;
  updated_at: string;
}

/**
 * List all providers, ordered by creation date descending.
 */
export async function listEmailProviders(): Promise<EmailProviderRecord[]> {
  return executeD1Query<EmailProviderRecord>(
    "SELECT * FROM email_providers ORDER BY created_at DESC",
  );
}

/**
 * Get a single provider by ID.
 */
export async function getEmailProvider(
  id: string,
): Promise<EmailProviderRecord | undefined> {
  const rows = await executeD1Query<EmailProviderRecord>(
    "SELECT * FROM email_providers WHERE id = ?",
    [id],
  );
  return rows[0];
}

/**
 * Create a new provider.
 * UNIQUE(type, domain) enforces at most one record per (type, domain).
 */
export async function createEmailProvider(data: {
  name: string;
  type: EmailProviderType;
  domain: string;
  config: string;
}): Promise<EmailProviderRecord> {
  const id = generateId();
  const now = new Date().toISOString();

  await executeD1Query(
    `INSERT INTO email_providers (id, name, type, domain, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.type, data.domain, data.config, now, now],
  );

  return {
    id,
    name: data.name,
    type: data.type,
    domain: data.domain,
    config: data.config,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Update a provider. Only provided fields are changed.
 */
export async function updateEmailProvider(
  id: string,
  data: {
    name?: string | undefined;
    type?: EmailProviderType | undefined;
    domain?: string | undefined;
    config?: string | undefined;
  },
): Promise<EmailProviderRecord | undefined> {
  const existing = await getEmailProvider(id);
  if (!existing) return undefined;

  const name = data.name ?? existing.name;
  const type = data.type ?? existing.type;
  const domain = data.domain ?? existing.domain;
  const config = data.config ?? existing.config;
  const now = new Date().toISOString();

  await executeD1Query(
    `UPDATE email_providers SET name = ?, type = ?, domain = ?, config = ?, updated_at = ? WHERE id = ?`,
    [name, type, domain, config, now, id],
  );

  return { ...existing, name, type, domain, config, updated_at: now };
}

/**
 * Delete a provider by ID. Callers should check countProjectsByProvider()
 * first and block deletion when the provider is in use.
 */
export async function deleteEmailProvider(id: string): Promise<boolean> {
  const existing = await getEmailProvider(id);
  if (!existing) return false;

  await executeD1Query("DELETE FROM email_providers WHERE id = ?", [id]);
  return true;
}

/**
 * Count projects that currently reference the given provider.
 * Used to block deletion of an in-use provider.
 */
export async function countProjectsByProvider(
  providerId: string,
): Promise<number> {
  const rows = await executeD1Query<{ count: number }>(
    "SELECT COUNT(*) as count FROM projects WHERE provider_id = ?",
    [providerId],
  );
  return rows[0]?.count ?? 0;
}
