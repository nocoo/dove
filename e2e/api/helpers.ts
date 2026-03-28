/**
 * E2E API test helpers — build requests, parse responses, D1 mock wiring.
 *
 * Strategy: Mock only the D1 client and Resend API (external I/O boundaries).
 * All business logic (validation, rendering, quota checks) runs for real.
 */

import { NextRequest } from "next/server";

const BASE = "http://localhost:17046";
const NOW = "2026-03-28T12:00:00.000Z";

// ---------------------------------------------------------------------------
// D1 query mock infrastructure
// ---------------------------------------------------------------------------

export type D1Handler = (sql: string, params: unknown[]) => unknown[];

let d1Handler: D1Handler = () => [];

export function setD1Handler(handler: D1Handler): void {
  d1Handler = handler;
}

export function resetD1Handler(): void {
  d1Handler = () => [];
}

/** Called by the mock.module("@/lib/db/d1-client") */
export function getD1Handler(): D1Handler {
  return (...args: Parameters<D1Handler>) => d1Handler(...args);
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

export function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj_e2e_test123456ab",
    name: "E2E Project",
    description: null,
    email_prefix: "noreply",
    from_name: "E2E App",
    webhook_token: "tok_e2e_0123456789abcdef0123456789abcdef012345678",
    quota_daily: 100,
    quota_monthly: 1000,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeRecipient(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcpt_e2e_test1234ab",
    project_id: "proj_e2e_test123456ab",
    name: "E2E User",
    email: "e2e@example.com",
    created_at: NOW,
    ...overrides,
  };
}

export function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmpl_e2e_test1234ab",
    project_id: "proj_e2e_test123456ab",
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

export function makeSendLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "slog_e2e_test1234ab",
    project_id: "proj_e2e_test123456ab",
    idempotency_key: null,
    payload_hash: null,
    template_id: "tmpl_e2e_test1234ab",
    recipient_id: "rcpt_e2e_test1234ab",
    to_email: "e2e@example.com",
    subject: "Test Subject",
    status: "sent",
    resend_id: "resend_e2e_123",
    error_message: null,
    created_at: NOW,
    sent_at: NOW,
    ...overrides,
  };
}

export function makeWebhookLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "wlog_e2e_test1234ab",
    project_id: "proj_e2e_test123456ab",
    method: "POST",
    path: "/api/webhook/proj_e2e_test123456ab/send",
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
// Request builders
// ---------------------------------------------------------------------------

/** Build a NextRequest (needed for routes that use request.nextUrl.searchParams) */
export function buildNextRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {},
): NextRequest {
  const { method = "GET", body, headers = {}, searchParams } = options;
  const url = new URL(path, BASE);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new NextRequest(url.toString(), init);
}

/** Build a plain Request (for routes that don't need NextRequest) */
export function buildRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  const { method = "GET", body, headers = {} } = options;
  const url = new URL(path, BASE);

  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request(url.toString(), init);
}

export function buildWebhookRequest(
  projectId: string,
  endpoint: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): Request {
  return buildRequest(`/api/webhook/${projectId}${endpoint}`, {
    method: options.method ?? "POST",
    body: options.body,
    headers: { authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export async function parseJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Next.js 16 route params (Promise-based)
// ---------------------------------------------------------------------------

export function routeParams<T extends Record<string, string>>(
  values: T,
): { params: Promise<T> } {
  return { params: Promise.resolve(values) };
}
