/**
 * Shared test helpers: mock fetch, D1 response builders, fixture factories.
 */

import type { Project } from "@/lib/db/projects";
import type { Recipient } from "@/lib/db/recipients";
import type { Template } from "@/lib/db/templates";
import type { SendLog } from "@/lib/db/send-logs";
import type { WebhookLog } from "@/lib/db/webhook-logs";

// ---------------------------------------------------------------------------
// D1 mock helpers — simulate Cloudflare Worker proxy responses
// ---------------------------------------------------------------------------

/**
 * Wrap a handler into a globalThis.fetch-compatible mock.
 */
export function mockFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return handler as unknown as typeof globalThis.fetch;
}

/**
 * Build a successful D1 proxy response.
 */
export function d1Success(results: unknown[] = []): Response {
  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Build an error D1 proxy response.
 */
export function d1Error(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { "content-type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

const NOW = "2026-03-28T12:00:00.000Z";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_test123456789ab",
    name: "Test Project",
    description: null,
    email_prefix: "noreply",
    from_name: "Test App",
    webhook_token: "tok_0123456789abcdef0123456789abcdef0123456789abcdef",
    quota_daily: 100,
    quota_monthly: 1000,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeRecipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: "rcpt_test12345678ab",
    project_id: "proj_test123456789ab",
    name: "Test User",
    email: "test@example.com",
    created_at: NOW,
    ...overrides,
  };
}

export function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tmpl_test12345678ab",
    project_id: "proj_test123456789ab",
    slug: "welcome",
    name: "Welcome Email",
    subject: "Welcome to {{app_name}}",
    body_markdown: "# Hello, {{name}}!\n\nWelcome aboard.",
    variables: JSON.stringify([
      { name: "app_name", type: "string", required: true },
      { name: "name", type: "string", required: true },
    ]),
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeSendLog(overrides: Partial<SendLog> = {}): SendLog {
  return {
    id: "slog_test12345678ab",
    project_id: "proj_test123456789ab",
    idempotency_key: null,
    payload_hash: null,
    template_id: "tmpl_test12345678ab",
    recipient_id: "rcpt_test12345678ab",
    to_email: "test@example.com",
    subject: "Test Subject",
    status: "sent",
    resend_id: "resend_abc123",
    error_message: null,
    created_at: NOW,
    sent_at: NOW,
    ...overrides,
  };
}

export function makeWebhookLog(overrides: Partial<WebhookLog> = {}): WebhookLog {
  return {
    id: "wlog_test12345678ab",
    project_id: "proj_test123456789ab",
    method: "POST",
    path: "/api/webhook/proj_test123456789ab/send",
    status_code: 200,
    error_code: null,
    error_message: null,
    duration_ms: 150,
    ip: "127.0.0.1",
    user_agent: "test-agent/1.0",
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module stub defaults — for mock.module()
// ---------------------------------------------------------------------------

export const PROJECT_STUBS = {
  listProjects: async () => [] as Project[],
  getProject: async () => undefined as Project | undefined,
  createProject: async () => makeProject(),
  updateProject: async () => makeProject(),
  deleteProject: async () => true,
  regenerateToken: async () => "new_token_value",
};

export const RECIPIENT_STUBS = {
  listRecipients: async () => [] as Recipient[],
  getRecipient: async () => undefined as Recipient | undefined,
  getRecipientByEmail: async () => undefined as Recipient | undefined,
  createRecipient: async () => makeRecipient(),
  updateRecipient: async () => makeRecipient(),
  deleteRecipient: async () => true,
};

export const TEMPLATE_STUBS = {
  listTemplates: async () => [] as Template[],
  listAllTemplates: async () => [] as Template[],
  getTemplate: async () => undefined as Template | undefined,
  getTemplateBySlug: async () => undefined as Template | undefined,
  createTemplate: async () => makeTemplate(),
  updateTemplate: async () => makeTemplate(),
  deleteTemplate: async () => true,
  parseVariables: () => [] as Array<{ name: string; type: string; required: boolean; default?: string | undefined }>,
};

export const SEND_LOG_STUBS = {
  listSendLogs: async () => [] as SendLog[],
  listAllSendLogs: async () => [] as SendLog[],
  findByIdempotencyKey: async () => undefined as SendLog | undefined,
  createSendLog: async () => makeSendLog({ status: "sending", resend_id: null, sent_at: null }),
  resetSendLogForRetry: async () => {},
  markSendLogSent: async () => {},
  markSendLogFailed: async () => {},
  countDailySends: async () => 0,
  countMonthlySends: async () => 0,
};

export const WEBHOOK_LOG_STUBS = {
  listWebhookLogs: async () => [] as WebhookLog[],
  listAllWebhookLogs: async () => [] as WebhookLog[],
  createWebhookLog: async () => {},
};

export const SANITIZE_STUBS = {
  sanitizeProject: (p: Project) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { webhook_token: _token, ...rest } = p;
    return rest;
  },
};
