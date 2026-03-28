/**
 * E2E: Webhook API — HEAD /api/webhook/[projectId],
 *       GET /api/webhook/[projectId]/templates,
 *       POST /api/webhook/[projectId]/send
 *
 * Real HTTP against running dev server on port 17046.
 *
 * NOTE: The happy-path send test actually calls the Resend API
 * and sends a real email. It uses RESEND_API_KEY from .env.local.
 * The recipient must be in the project's whitelist.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  get,
  post,
  head,
  parseJson,
  webhookHeaders,
  setupTestProject,
  setupTestRecipient,
  setupTestTemplate,
  cleanupProject,
} from "./helpers";

let projectId: string;
let webhookToken: string;
let recipientEmail: string;
let templateSlug: string;

beforeAll(async () => {
  // Create a full test environment: project + recipient + template
  const project = await setupTestProject();
  projectId = project.id;
  webhookToken = project.webhook_token;

  const recipient = await setupTestRecipient(projectId, {
    email: `e2e-webhook-${Date.now()}@example.com`,
  });
  recipientEmail = recipient.email;

  const template = await setupTestTemplate(projectId, {
    subject: "E2E Test: Hello {{name}}",
    body_markdown: "# Hi {{name}}\n\nThis is an E2E test email.",
    variables: [{ name: "name", type: "string", required: true }],
  });
  templateSlug = template.slug;
});

afterAll(async () => {
  await cleanupProject(projectId);
});

// ---------------------------------------------------------------------------
// HEAD /api/webhook/[projectId]
// ---------------------------------------------------------------------------

describe("HEAD /api/webhook/[projectId]", () => {
  test("returns 200 with valid token", async () => {
    const response = await head(`/api/webhook/${projectId}`, {
      headers: webhookHeaders(webhookToken),
    });
    expect(response.status).toBe(200);
  });

  test("returns 401 without auth header", async () => {
    const response = await head(`/api/webhook/${projectId}`);
    expect(response.status).toBe(401);
  });

  test("returns 403 with wrong token", async () => {
    const response = await head(`/api/webhook/${projectId}`, {
      headers: webhookHeaders("wrong_token_000000000000000000000000000000000000000"),
    });
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webhook/[projectId]/templates
// ---------------------------------------------------------------------------

describe("GET /api/webhook/[projectId]/templates", () => {
  test("returns template list with valid token", async () => {
    const response = await get(`/api/webhook/${projectId}/templates`, {
      headers: webhookHeaders(webhookToken),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("returns 401 without auth", async () => {
    const response = await get(`/api/webhook/${projectId}/templates`);
    expect(response.status).toBe(401);
  });

  test("returns 403 with wrong token", async () => {
    const response = await get(`/api/webhook/${projectId}/templates`, {
      headers: webhookHeaders("wrong_token_000000000000000000000000000000000000000"),
    });
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhook/[projectId]/send
// ---------------------------------------------------------------------------

describe("POST /api/webhook/[projectId]/send", () => {
  const makePayload = (overrides: Record<string, unknown> = {}) => ({
    template: templateSlug,
    to: recipientEmail,
    variables: { name: "E2E Test User" },
    ...overrides,
  });

  // Step 1: Auth errors (no Resend call)
  test("returns 401 without Authorization header", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload(),
    });
    expect(response.status).toBe(401);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("auth_missing");
  });

  test("returns 403 with wrong token", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload(),
      headers: webhookHeaders("wrong_token_000000000000000000000000000000000000000"),
    });
    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("auth_invalid");
  });

  // Step 2: Parse errors (no Resend call)
  test("returns 400 for invalid JSON", async () => {
    const url = `http://localhost:${process.env.PORT ?? 17046}/api/webhook/${projectId}/send`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${webhookToken}`,
      },
      body: "not json",
    });
    expect(response.status).toBe(400);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("body_invalid");
  });

  test("returns 400 for missing required fields", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: { template: templateSlug },
      headers: webhookHeaders(webhookToken),
    });
    expect(response.status).toBe(400);
  });

  // Step 5: Recipient not found (no Resend call)
  test("returns 404 for unknown recipient", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload({ to: "nonexistent@example.com" }),
      headers: webhookHeaders(webhookToken),
    });
    expect(response.status).toBe(404);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("recipient_not_found");
  });

  // Step 6: Template not found (no Resend call)
  test("returns 404 for unknown template slug", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload({ template: "nonexistent-slug" }),
      headers: webhookHeaders(webhookToken),
    });
    expect(response.status).toBe(404);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("template_not_found");
  });

  // Step 8: Missing variables (no Resend call)
  test("returns 422 for missing required variables", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload({ variables: {} }),
      headers: webhookHeaders(webhookToken),
    });
    expect(response.status).toBe(422);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("variables_invalid");
  });

  // Happy path — actually sends an email via Resend
  test("sends email successfully (full pipeline)", async () => {
    const response = await post(`/api/webhook/${projectId}/send`, {
      body: makePayload(),
      headers: webhookHeaders(webhookToken),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ id: string; resend_id: string; status: string }>(response);
    expect(body.status).toBe("sent");
    expect(body.resend_id).toBeDefined();
    expect(typeof body.resend_id).toBe("string");
  });
});
