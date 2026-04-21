import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import type { Project } from "../lib/db/projects";
import type { SendLog } from "../lib/db/send-logs";
import type { Template } from "../lib/db/templates";

// --- Mocks ---

const sampleProject: Project = {
  id: "proj_001",
  name: "Acme",
  description: null,
  email_prefix: "noreply",
  from_name: "Acme Inc",
  webhook_token: "tok_secret_48chars_xxxxxxxxxxxxxxxxxxxxxxxxxx",
  quota_daily: 100,
  quota_monthly: 1000,
  provider_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sampleTemplate: Template = {
  id: "tmpl_001",
  project_id: "proj_001",
  name: "Welcome",
  slug: "welcome",
  subject: "Hello {{name}}",
  body_markdown: "Welcome, **{{name}}**!",
  variables: JSON.stringify([{ name: "name", type: "string", required: true }]),
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sampleRecipient = {
  id: "rcpt_001",
  project_id: "proj_001",
  email: "user@example.com",
  name: "User",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sampleSendLog: SendLog = {
  id: "send_001",
  project_id: "proj_001",
  idempotency_key: null,
  payload_hash: null,
  template_id: "tmpl_001",
  recipient_id: "rcpt_001",
  to_email: "user@example.com",
  subject: "Hello World",
  status: "sending",
  resend_id: null,
  provider_id: null,
  provider_type: null,
  provider_message_id: null,
  error_message: null,
  created_at: "2026-01-01T00:00:00Z",
  sent_at: null,
};

const mockGetProject = mock(() => Promise.resolve(sampleProject as Project | null));
const mockGetRecipient = mock(() => Promise.resolve(null as typeof sampleRecipient | null));
const mockGetRecipientByEmail = mock(() => Promise.resolve(sampleRecipient as typeof sampleRecipient | null));
const mockGetTemplateBySlug = mock(() => Promise.resolve(sampleTemplate as Template | null));
const mockListTemplates = mock(() => Promise.resolve([sampleTemplate]));
const mockParseVariables = mock(() => [{ name: "name", type: "string" as const, required: true }]);
const mockFindByIdempotencyKey = mock(() => Promise.resolve(null as SendLog | null));
const mockCreateSendLog = mock(() => Promise.resolve(sampleSendLog));
const mockResetSendLogForRetry = mock(() => Promise.resolve());
const mockUpdateSendLogProvider = mock(() => Promise.resolve());
const mockMarkSendLogSent = mock(() => Promise.resolve());
const mockMarkSendLogFailed = mock(() => Promise.resolve());
const mockCreateWebhookLog = mock(() => Promise.resolve());
const mockGetEmailProvider = mock(() => Promise.resolve(null));
const mockCheckQuota = mock(() => Promise.resolve({ allowed: true } as { allowed: boolean; error_code?: string }));
const mockRenderTemplate = mock(() => Promise.resolve({ subject: "Hello World", html: "<p>Welcome!</p>" }));

const mockProviderSend = mock(() => Promise.resolve({ id: "msg_001" }));
const mockCreateProvider = mock(() =>
  Promise.resolve({
    type: "resend" as const,
    send: mockProviderSend,
    supportsDryRun: () => true,
    setDryRun: () => {},
  }),
);
const mockCreateLegacyProvider = mock(() =>
  Promise.resolve({
    type: "resend" as const,
    send: mockProviderSend,
    supportsDryRun: () => true,
    setDryRun: () => {},
  }),
);
const mockGetProviderDomain = mock(() => "example.com");

mock.module("../lib/db/projects", () => ({ getProject: mockGetProject }));
mock.module("../lib/db/recipients", () => ({
  getRecipient: mockGetRecipient,
  getRecipientByEmail: mockGetRecipientByEmail,
}));
mock.module("../lib/db/templates", () => ({
  getTemplateBySlug: mockGetTemplateBySlug,
  listTemplates: mockListTemplates,
  parseVariables: mockParseVariables,
}));
mock.module("../lib/db/send-logs", () => ({
  findByIdempotencyKey: mockFindByIdempotencyKey,
  createSendLog: mockCreateSendLog,
  resetSendLogForRetry: mockResetSendLogForRetry,
  updateSendLogProvider: mockUpdateSendLogProvider,
  markSendLogSent: mockMarkSendLogSent,
  markSendLogFailed: mockMarkSendLogFailed,
}));
mock.module("../lib/db/webhook-logs", () => ({
  createWebhookLog: mockCreateWebhookLog,
}));
mock.module("../lib/db/email-providers", () => ({
  getEmailProvider: mockGetEmailProvider,
}));
mock.module("../lib/email/quota", () => ({ checkQuota: mockCheckQuota }));
mock.module("../lib/email/render", () => ({ renderTemplate: mockRenderTemplate }));
mock.module("../lib/email/provider", () => ({
  createProvider: mockCreateProvider,
  createLegacyProvider: mockCreateLegacyProvider,
  parseProviderConfig: mock(() => ({ type: "resend", api_key: "re_test" })),
  getProviderDomain: mockGetProviderDomain,
}));

const { webhook } = await import("../routes/webhook");

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", webhook);
  const env = {
    DB: {} as D1Database,
    RESEND_API_KEY: "re_test",
    RESEND_FROM_DOMAIN: "example.com",
  } as unknown as Env;
  return {
    req: (path: string, init?: RequestInit) => app.request(path, init, env),
  };
}

function sendRequest(
  body: Record<string, unknown>,
  token = sampleProject.webhook_token,
) {
  const { req } = createApp();
  return req("/proj_001/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetProject.mockClear();
  mockGetRecipient.mockClear();
  mockGetRecipientByEmail.mockClear();
  mockGetTemplateBySlug.mockClear();
  mockListTemplates.mockClear();
  mockFindByIdempotencyKey.mockClear();
  mockCreateSendLog.mockClear();
  mockResetSendLogForRetry.mockClear();
  mockUpdateSendLogProvider.mockClear();
  mockMarkSendLogSent.mockClear();
  mockMarkSendLogFailed.mockClear();
  mockCreateWebhookLog.mockClear();
  mockCheckQuota.mockClear();
  mockRenderTemplate.mockClear();
  mockProviderSend.mockClear();
  mockCreateLegacyProvider.mockClear();
  mockGetProviderDomain.mockClear();
  mockGetEmailProvider.mockClear();

  // Reset to defaults
  mockGetProject.mockImplementation(() => Promise.resolve(sampleProject));
  mockGetRecipientByEmail.mockImplementation(() => Promise.resolve(sampleRecipient));
  mockGetTemplateBySlug.mockImplementation(() => Promise.resolve(sampleTemplate));
  mockCheckQuota.mockImplementation(() => Promise.resolve({ allowed: true }));
  mockRenderTemplate.mockImplementation(() => Promise.resolve({ subject: "Hello World", html: "<p>Welcome!</p>" }));
  mockCreateSendLog.mockImplementation(() => Promise.resolve(sampleSendLog));
  mockProviderSend.mockImplementation(() => Promise.resolve({ id: "msg_001" }));
  mockCreateLegacyProvider.mockImplementation(() =>
    Promise.resolve({
      type: "resend" as const,
      send: mockProviderSend,
      supportsDryRun: () => true,
      setDryRun: () => {},
    }),
  );
  mockGetProviderDomain.mockImplementation(() => "example.com");
  mockFindByIdempotencyKey.mockImplementation(() => Promise.resolve(null));
  mockGetEmailProvider.mockImplementation(() => Promise.resolve(null));
});

describe("webhook route handlers", () => {
  describe("GET /:projectId (health)", () => {
    test("returns 200 with valid token", async () => {
      const { req } = createApp();
      const res = await req("/proj_001", {
        headers: { Authorization: `Bearer ${sampleProject.webhook_token}` },
      });
      expect(res.status).toBe(200);
    });

    test("returns 401 without auth header", async () => {
      const { req } = createApp();
      const res = await req("/proj_001");
      expect(res.status).toBe(401);
    });

    test("returns 403 with wrong token", async () => {
      const { req } = createApp();
      const res = await req("/proj_001", {
        headers: { Authorization: "Bearer wrong_token" },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /:projectId/templates", () => {
    test("returns template list", async () => {
      const { req } = createApp();
      const res = await req("/proj_001/templates", {
        headers: { Authorization: `Bearer ${sampleProject.webhook_token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>[];
      expect(body).toHaveLength(1);
      expect(body[0]!.slug).toBe("welcome");
    });

    test("returns 401 without auth", async () => {
      const { req } = createApp();
      const res = await req("/proj_001/templates");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /:projectId/send", () => {
    test("sends email successfully (happy path)", async () => {
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("sent");
      expect(body.provider_message_id).toBe("msg_001");
    });

    test("returns 401 without auth", async () => {
      const { req } = createApp();
      const res = await req("/proj_001/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: "welcome", to: "user@example.com" }),
      });
      expect(res.status).toBe(401);
    });

    test("returns 403 with invalid token", async () => {
      const res = await sendRequest(
        { template: "welcome", to: "user@example.com" },
        "wrong_token",
      );
      expect(res.status).toBe(403);
    });

    test("returns 400 for invalid body", async () => {
      const res = await sendRequest({});
      expect(res.status).toBe(400);
    });

    test("returns 429 when quota exceeded", async () => {
      mockCheckQuota.mockImplementation(() =>
        Promise.resolve({ allowed: false, error_code: "quota_daily_exceeded" }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(429);
    });

    test("returns 404 when recipient not found", async () => {
      mockGetRecipientByEmail.mockImplementation(() => Promise.resolve(null));
      const res = await sendRequest({
        template: "welcome",
        to: "unknown@example.com",
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("recipient_not_found");
    });

    test("returns 404 when template not found", async () => {
      mockGetTemplateBySlug.mockImplementation(() => Promise.resolve(null));
      const res = await sendRequest({
        template: "nonexistent",
        to: "user@example.com",
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("template_not_found");
    });

    test("returns 422 when variables invalid", async () => {
      mockRenderTemplate.mockImplementation(() => {
        throw new Error("Missing required variable: name");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(422);
    });

    test("returns 502 when provider send fails", async () => {
      mockProviderSend.mockImplementation(() => {
        throw new Error("API error");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(502);
      expect(mockMarkSendLogFailed).toHaveBeenCalled();
    });

    test("returns cached result for duplicate idempotency key (sent)", async () => {
      mockFindByIdempotencyKey.mockImplementation(() =>
        Promise.resolve({
          ...sampleSendLog,
          status: "sent" as const,
          idempotency_key: "key_001",
          provider_message_id: "msg_cached",
          provider_type: "resend" as const,
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_001",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("sent");
      expect(mockProviderSend).not.toHaveBeenCalled();
    });

    test("returns 409 for in-progress idempotency key", async () => {
      mockFindByIdempotencyKey.mockImplementation(() =>
        Promise.resolve({
          ...sampleSendLog,
          status: "sending" as const,
          idempotency_key: "key_002",
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_002",
      });
      expect(res.status).toBe(409);
    });

    test("retries failed send with same idempotency key", async () => {
      mockFindByIdempotencyKey.mockImplementation(() =>
        Promise.resolve({
          ...sampleSendLog,
          status: "failed" as const,
          idempotency_key: "key_003",
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_003",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      expect(mockResetSendLogForRetry).toHaveBeenCalled();
    });

    test("creates webhook log on every response", async () => {
      await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(mockCreateWebhookLog).toHaveBeenCalled();
    });
  });
});
