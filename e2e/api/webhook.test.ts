/**
 * E2E: Webhook API — HEAD /api/webhook/[projectId],
 *       GET /api/webhook/[projectId]/templates,
 *       POST /api/webhook/[projectId]/send
 *
 * Mocks D1 client + Resend API. All business logic (auth, quota, render) runs for real.
 */
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import {
  buildRequest,
  buildWebhookRequest,
  parseJson,
  routeParams,
  makeProject,
  makeRecipient,
  makeTemplate,
  getD1Handler,
  setD1Handler,
  resetD1Handler,
} from "./helpers";

// ---------------------------------------------------------------------------
// Mock boundaries: D1 + Resend
// ---------------------------------------------------------------------------

let resendShouldFail = false;
let resendCallCount = 0;

mock.module("@/lib/db/d1-client", () => ({
  isD1Configured: () => true,
  executeD1Query: async (sql: string, params: unknown[] = []) => getD1Handler()(sql, params),
}));

mock.module("@/lib/email/resend", () => ({
  sendEmail: async () => {
    resendCallCount++;
    if (resendShouldFail) throw new Error("Resend API error: 500");
    return { id: "resend_msg_e2e_001" };
  },
}));

const project = makeProject();
const recipient = makeRecipient();
const template = makeTemplate();

/**
 * Set up D1 handler for the full send pipeline.
 * Maps SQL patterns to fixture data.
 */
function setupSendPipelineD1(overrides: {
  quotaDailyUsed?: number;
  quotaMonthlyUsed?: number;
  findIdempotency?: Record<string, unknown> | null;
} = {}) {
  const { quotaDailyUsed = 5, quotaMonthlyUsed = 42, findIdempotency = null } = overrides;

  setD1Handler((sql, params) => {
    // getProject
    if (sql.includes("FROM projects") && sql.includes("WHERE id = ?")) {
      return params[0] === project.id ? [project] : [];
    }
    // getRecipientByEmail
    if (sql.includes("FROM recipients") && sql.includes("email = ?")) {
      const email = params.find((p) => typeof p === "string" && p.includes("@"));
      return email === recipient.email ? [recipient] : [];
    }
    // getRecipient (by ID)
    if (sql.includes("FROM recipients") && sql.includes("WHERE id = ?")) {
      return params[0] === recipient.id ? [recipient] : [];
    }
    // getTemplateBySlug
    if (sql.includes("FROM templates") && sql.includes("slug = ?")) {
      return params[1] === template.slug ? [template] : [];
    }
    // listTemplates (for webhook/templates route)
    if (sql.includes("FROM templates") && sql.includes("project_id")) {
      return [template];
    }
    // findByIdempotencyKey
    if (sql.includes("idempotency_key = ?")) {
      return findIdempotency ? [findIdempotency] : [];
    }
    // countDailySends — SQL: "date('now')" without strftime
    if (sql.includes("COUNT") && sql.includes("sent_at") && sql.includes("date('now')") && !sql.includes("strftime")) {
      return [{ count: quotaDailyUsed }];
    }
    // countMonthlySends — SQL: "strftime('%Y-%m-01', 'now')"
    if (sql.includes("COUNT") && sql.includes("sent_at") && sql.includes("strftime")) {
      return [{ count: quotaMonthlyUsed }];
    }
    // createSendLog / markSendLogSent / markSendLogFailed / other writes
    if (sql.includes("INSERT") || sql.includes("UPDATE")) {
      return [];
    }
    return [];
  });
}

beforeEach(() => {
  resetD1Handler();
  resendShouldFail = false;
  resendCallCount = 0;
  process.env.RESEND_FROM_DOMAIN = "mail.example.com";
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// HEAD /api/webhook/[projectId]
// ---------------------------------------------------------------------------

describe("HEAD /api/webhook/[projectId]", () => {
  test("returns 200 with valid token", async () => {
    setupSendPipelineD1();
    const { HEAD } = await import("@/app/api/webhook/[projectId]/route");
    const request = buildRequest(`/api/webhook/${project.id}`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${project.webhook_token}` },
    });

    const response = await HEAD(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(200);
  });

  test("returns 401 without auth header", async () => {
    const { HEAD } = await import("@/app/api/webhook/[projectId]/route");
    const request = buildRequest(`/api/webhook/${project.id}`, { method: "HEAD" });

    const response = await HEAD(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(401);
  });

  test("returns 403 with wrong token", async () => {
    setupSendPipelineD1();
    const { HEAD } = await import("@/app/api/webhook/[projectId]/route");
    const request = buildRequest(`/api/webhook/${project.id}`, {
      method: "HEAD",
      headers: { authorization: "Bearer wrong_token" },
    });

    const response = await HEAD(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webhook/[projectId]/templates
// ---------------------------------------------------------------------------

describe("GET /api/webhook/[projectId]/templates", () => {
  test("returns template list with valid token", async () => {
    setupSendPipelineD1();
    const { GET } = await import("@/app/api/webhook/[projectId]/templates/route");
    const request = buildWebhookRequest(project.id, "/templates", project.webhook_token, {
      method: "GET",
    });

    const response = await GET(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(200);
    const body = await parseJson<unknown[]>(response);
    expect(body).toHaveLength(1);
  });

  test("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/webhook/[projectId]/templates/route");
    const request = buildRequest(`/api/webhook/${project.id}/templates`);

    const response = await GET(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(401);
  });

  test("returns 403 with wrong token", async () => {
    setupSendPipelineD1();
    const { GET } = await import("@/app/api/webhook/[projectId]/templates/route");
    const request = buildWebhookRequest(project.id, "/templates", "wrong_token", {
      method: "GET",
    });

    const response = await GET(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhook/[projectId]/send — Full 12-step pipeline
// ---------------------------------------------------------------------------

describe("POST /api/webhook/[projectId]/send", () => {
  const validPayload = {
    template: "welcome",
    to: "e2e@example.com",
    variables: { app_name: "TestApp", name: "Alice" },
  };

  // Happy path — all 12 steps pass
  test("sends email successfully (full pipeline)", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(200);

    const body = await parseJson<{ id: string; resend_id: string; status: string }>(response);
    expect(body.status).toBe("sent");
    expect(body.resend_id).toBe("resend_msg_e2e_001");
    expect(resendCallCount).toBe(1);
  });

  // Step 1: Auth
  test("returns 401 without Authorization header", async () => {
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildRequest(`/api/webhook/${project.id}/send`, {
      method: "POST",
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(401);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("auth_missing");
  });

  test("returns 403 with wrong token", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", "wrong_token", {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("auth_invalid");
  });

  // Step 2: Parse
  test("returns 400 for invalid JSON", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = new Request(`http://localhost:17046/api/webhook/${project.id}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${project.webhook_token}`,
      },
      body: "not json",
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(400);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("body_invalid");
  });

  test("returns 400 for missing required fields", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { template: "welcome" },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(400);
  });

  // Step 4: Quota
  test("returns 429 when daily quota exceeded", async () => {
    setupSendPipelineD1({ quotaDailyUsed: 100 });
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(429);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("quota_daily_exceeded");
  });

  test("returns 429 when monthly quota exceeded", async () => {
    setupSendPipelineD1({ quotaDailyUsed: 5, quotaMonthlyUsed: 1000 });
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(429);
  });

  // Step 5: Recipient
  test("returns 404 for unknown recipient", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { ...validPayload, to: "unknown@example.com" },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(404);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("recipient_not_found");
  });

  // Step 6: Template
  test("returns 404 for unknown template slug", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { ...validPayload, template: "nonexistent" },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(404);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("template_not_found");
  });

  // Step 8: Variables
  test("returns 422 for missing required variables", async () => {
    setupSendPipelineD1();
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { template: "welcome", to: "e2e@example.com", variables: {} },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(422);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("variables_invalid");
  });

  // Step 10: RESEND_FROM_DOMAIN missing
  test("returns 500 when RESEND_FROM_DOMAIN not set", async () => {
    setupSendPipelineD1();
    delete process.env.RESEND_FROM_DOMAIN;
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(500);
  });

  // Step 10: Resend failure
  test("returns 502 when Resend API fails", async () => {
    setupSendPipelineD1();
    resendShouldFail = true;
    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: validPayload,
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(502);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("resend_failed");
  });

  // Step 3: Idempotency — already sent
  test("returns cached result for already-sent idempotency key", async () => {
    setupSendPipelineD1({
      findIdempotency: {
        id: "slog_cached_001",
        status: "sent",
        resend_id: "resend_cached_001",
        payload_hash: null,
      },
    });

    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { ...validPayload, idempotency_key: "key123" },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(200);
    const body = await parseJson<{ status: string; resend_id: string }>(response);
    expect(body.status).toBe("sent");
    expect(body.resend_id).toBe("resend_cached_001");
    expect(resendCallCount).toBe(0); // should NOT call Resend
  });

  // Step 3: Idempotency — in-progress
  test("returns 409 for in-progress idempotency key", async () => {
    setupSendPipelineD1({
      findIdempotency: {
        id: "slog_progress_001",
        status: "sending",
        payload_hash: null,
      },
    });

    const { POST } = await import("@/app/api/webhook/[projectId]/send/route");
    const request = buildWebhookRequest(project.id, "/send", project.webhook_token, {
      body: { ...validPayload, idempotency_key: "key456" },
    });

    const response = await POST(request, routeParams({ projectId: project.id }));
    expect(response.status).toBe(409);
    const body = await parseJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("send_in_progress");
  });
});
