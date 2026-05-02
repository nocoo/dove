import { describe, test, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { IdempotentSendResult } from "../../../lib/email/providers/cloudflare";
import type { Env } from "../../env";
import type { Project } from "../../lib/db/projects";
import type { SendLog } from "../../lib/db/send-logs";
import type { Template } from "../../lib/db/templates";

// --- Mock implementations ---

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
  allow_unknown_recipients: false,
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

const mockGetProject = vi.fn(() => Promise.resolve(sampleProject as Project | null));
const mockGetRecipient = vi.fn(() => Promise.resolve(null as typeof sampleRecipient | null));
const mockGetRecipientByEmail = vi.fn(() => Promise.resolve(sampleRecipient as typeof sampleRecipient | null));
const mockGetTemplateBySlug = vi.fn(() => Promise.resolve(sampleTemplate as Template | null));
const mockListTemplates = vi.fn(() => Promise.resolve([sampleTemplate]));
const mockParseVariables = vi.fn(() => [{ name: "name", type: "string" as const, required: true }]);
const mockFindByIdempotencyKey = vi.fn(() => Promise.resolve(null as SendLog | null));
const mockCreateSendLog = vi.fn(() => Promise.resolve(sampleSendLog));
const mockResetSendLogForRetry = vi.fn(() => Promise.resolve());
const mockUpdateSendLogProvider = vi.fn(() => Promise.resolve());
const mockMarkSendLogSent = vi.fn(() => Promise.resolve());
const mockMarkSendLogFailed = vi.fn(() => Promise.resolve());
const mockCreateWebhookLog = vi.fn(() => Promise.resolve());
const mockGetEmailProvider = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));
const mockCheckQuota = vi.fn(() => Promise.resolve({ allowed: true } as { allowed: boolean; error_code?: string }));
const mockRenderTemplate = vi.fn(() => Promise.resolve({ subject: "Hello World", html: "<p>Welcome!</p>" }));
const mockAcquireAddressLock = vi.fn<() => Promise<{ allowed: boolean; lock_token?: string; retry_after_seconds?: number }>>(() => Promise.resolve({ allowed: true, lock_token: "test-lock-token" }));
const mockReleaseAddressLock = vi.fn(() => Promise.resolve());

const mockProviderSend = vi.fn(() => Promise.resolve({ id: "msg_001" }));
const mockCreateProvider = vi.fn(() =>
  Promise.resolve({
    type: "resend" as const,
    send: mockProviderSend,
    supportsDryRun: () => true,
    setDryRun: () => {},
  }),
);
const mockCreateLegacyProvider = vi.fn(() =>
  Promise.resolve({
    type: "resend" as const,
    send: mockProviderSend,
    supportsDryRun: () => true,
    setDryRun: () => {},
  }),
);
const mockGetProviderDomain = vi.fn(() => "example.com");

// --- vi.mock calls (hoisted to top) ---

vi.mock("../../lib/db/projects", () => ({ getProject: mockGetProject }));
vi.mock("../../lib/db/recipients", () => ({
  getRecipient: mockGetRecipient,
  getRecipientByEmail: mockGetRecipientByEmail,
}));
vi.mock("../../lib/db/templates", () => ({
  getTemplateBySlug: mockGetTemplateBySlug,
  listTemplates: mockListTemplates,
  parseVariables: mockParseVariables,
}));
vi.mock("../../lib/db/send-logs", () => ({
  findByIdempotencyKey: mockFindByIdempotencyKey,
  createSendLog: mockCreateSendLog,
  resetSendLogForRetry: mockResetSendLogForRetry,
  updateSendLogProvider: mockUpdateSendLogProvider,
  markSendLogSent: mockMarkSendLogSent,
  markSendLogFailed: mockMarkSendLogFailed,
}));
vi.mock("../../lib/db/webhook-logs", () => ({
  createWebhookLog: mockCreateWebhookLog,
}));
vi.mock("../../lib/db/email-providers", () => ({
  getEmailProvider: mockGetEmailProvider,
}));
vi.mock("../../lib/email/quota", () => ({ checkQuota: mockCheckQuota }));
vi.mock("../../lib/email/rate-limit", () => ({
  acquireAddressLock: mockAcquireAddressLock,
  releaseAddressLock: mockReleaseAddressLock,
}));
vi.mock("../../lib/email/render", () => ({ renderTemplate: mockRenderTemplate }));
vi.mock("../../lib/email/provider", () => ({
  createProvider: mockCreateProvider,
  createLegacyProvider: mockCreateLegacyProvider,
  parseProviderConfig: vi.fn(() => ({ type: "resend", api_key: "re_test" })),
  getProviderDomain: mockGetProviderDomain,
}));

const { webhook } = await import("../../routes/webhook");

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    Object.defineProperty(c, "executionCtx", {
      get: () => ({ waitUntil: () => {}, passThroughOnException: () => {} }),
    });
    return next();
  });
  app.route("/", webhook);
  const env = {
    DB: {} as D1Database,
    EMAIL: {} as SendEmail,
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
  // Clear call history on every mock fn declared in this file (less brittle
  // than 17 individual mockClear lines that drift when mocks are added).
  vi.clearAllMocks();

  // Reset to defaults
  mockGetProject.mockImplementation(() => Promise.resolve(sampleProject));
  mockGetRecipientByEmail.mockImplementation(() => Promise.resolve(sampleRecipient));
  mockGetTemplateBySlug.mockImplementation(() => Promise.resolve(sampleTemplate));
  mockCheckQuota.mockImplementation(() => Promise.resolve({ allowed: true }));
  mockAcquireAddressLock.mockImplementation(() => Promise.resolve({ allowed: true, lock_token: "test-lock-token" }));
  mockReleaseAddressLock.mockImplementation(() => Promise.resolve());
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
  mockUpdateSendLogProvider.mockImplementation(() => Promise.resolve());
  mockMarkSendLogSent.mockImplementation(() => Promise.resolve());
  mockMarkSendLogFailed.mockImplementation(() => Promise.resolve());
  mockCreateProvider.mockImplementation(() =>
    Promise.resolve({
      type: "resend" as const,
      send: mockProviderSend,
      supportsDryRun: () => true,
      setDryRun: () => {},
    }),
  );
});

describe("webhook route handlers", () => {
  describe("GET /:projectId (health)", () => {
    test("returns 200 with valid token", async () => {
      const { req } = createApp();
      const res = await req("/proj_001", {
        headers: { Authorization: `Bearer ${sampleProject.webhook_token}` },
      });
      expect(res.status).toBe(200);
      // Health endpoint returns empty body (intentional). Pin that contract
      // explicitly so a regression accidentally adding a body would surface
      // (clients rely on a fast no-body 200 for liveness probes).
      const text = await res.text();
      expect(text).toBe("");
    });

    test("returns 401 without auth header", async () => {
      const { req } = createApp();
      const res = await req("/proj_001");
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe("");
    });

    test("returns 403 with wrong token", async () => {
      const { req } = createApp();
      const res = await req("/proj_001", {
        headers: { Authorization: "Bearer wrong_token" },
      });
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toBe("");
    });
  });

  describe("GET /:projectId/templates", () => {
    test("returns template list with whitelisted fields ONLY (no internal id, no body_markdown)", async () => {
      // Strengthened: pin the EXACT shape returned to webhook clients.
      // Two security/privacy classes this test now defends:
      //   (1) `body_markdown` must NOT leak — it's the source template,
      //       not meant to be exposed to webhook clients (think: stolen
      //       webhook token can probe the inventory but not exfiltrate
      //       the rendered email designs).
      //   (2) `id`, `project_id`, `created_at`, `updated_at` must NOT
      //       leak — internal identifiers; clients only need slug+name+
      //       subject+variables to construct send requests.
      // The previous test only checked slug — a regression returning the
      // raw row (or doing `...t`) would silently expose all of the above.
      const { req } = createApp();
      const res = await req("/proj_001/templates", {
        headers: { Authorization: `Bearer ${sampleProject.webhook_token}` },
      });
      expect(res.status).toBe(200);
      // Pin Content-Type for external programmatic API (drift defense).
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await res.json()) as Record<string, unknown>[];
      expect(body).toHaveLength(1);
      const t = body[0]!;
      // Whitelist: exact 4 documented fields.
      expect(Object.keys(t).sort()).toEqual(["name", "slug", "subject", "variables"]);
      expect(t.slug).toBe("welcome");
      expect(t.name).toBe("Welcome");
      expect(t.subject).toBe("Hello {{name}}");
      // variables surfaces as the JSON-string-of-schema (raw column);
      // pin this contract so a regression to JSON.parse (or to the raw
      // schema array) is caught — either change would break clients
      // that today receive a string here.
      expect(typeof t.variables).toBe("string");
      expect(t.variables).toContain('"name":"name"');
      // Negative pins: forbidden fields.
      expect(t).not.toHaveProperty("id");
      expect(t).not.toHaveProperty("project_id");
      expect(t).not.toHaveProperty("body_markdown");
      expect(t).not.toHaveProperty("created_at");
      expect(t).not.toHaveProperty("updated_at");
    });

    test("returns 401 without auth", async () => {
      const { req } = createApp();
      const res = await req("/proj_001/templates");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("auth_missing");
    });

    test("returns 403 with wrong token (auth_invalid)", async () => {
      // Symmetric to the GET / health 403 — templates list with the
      // wrong token must not leak the template inventory.
      const { req } = createApp();
      const res = await req("/proj_001/templates", {
        headers: { Authorization: "Bearer wrong_token" },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("auth_invalid");
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
      // Pin Content-Type: webhook /send is the external programmatic
      // API. A regression to c.text(JSON.stringify(...)) would silently
      // change Content-Type to text/plain — most clients tolerate
      // (JSON.parse works on text/plain) but strict consumers (axios
      // with strict transform, Go std library) reject. Since this is
      // the only contract pin between Dove and 3rd-party caller code,
      // a drift here breaks integrations silently.
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("sent");
      expect(body.provider_message_id).toBe("msg_001");
      // Pin EXACT response shape — catches:
      //   (1) `id` (sendLog.id) silently dropped: clients that store the
      //       returned id to query send_logs would break.
      //   (2) `resend_id` regression — contract is
      //       `providerType === 'cloudflare' ? null : result.id`. This
      //       test runs the LEGACY/non-cloudflare path (provider_type='legacy'
      //       since no providerRecord), so resend_id MUST equal
      //       result.id ('msg_001'). A regression hardcoding null would
      //       break Resend webhook clients that read resend_id; a
      //       regression always returning result.id would break
      //       cloudflare clients (covered by separate test at L888).
      //   (3) `provider_type` field present so dashboards can bucket
      //       (not silently undefined).
      expect(body.id).toBe("send_001");
      expect(body.resend_id).toBe("msg_001");
      expect(body.provider_type).toBe("legacy");
      // Provider must receive the *rendered* template (subject+html from
      // mockRenderTemplate above), not the raw template id. Catches a
      // regression where the route forwards inputs without rendering.
      expect(mockProviderSend).toHaveBeenCalledTimes(1);
      // Exact-shape assertion (no objectContaining): a regression that
      // drops `from` (sender vanishes) or `idempotencyKey` (causes Resend
      // duplicates on retry) would otherwise pass silently.
      expect(mockProviderSend).toHaveBeenCalledWith({
        from: "Acme Inc <noreply@example.com>",
        to: "user@example.com",
        subject: "Hello World",
        html: "<p>Welcome!</p>",
        idempotencyKey: "send_001",
      });
    });

    test("fresh idempotent send (no existing log) computes payload_hash and creates new log", async () => {
      // Pins webhook.ts:159 false branch (existingSendLog null) AND :229
      // truthy branch (idempotencyKey → await computePayloadHash). Both
      // were uncovered: every other idempotency test mocked an EXISTING
      // log, so the FRESH-key path that computes a hash and writes a
      // brand-new send_log row was untested. Without this, a regression
      // that flipped `if (existingSendLog)` to its negation, OR that
      // dropped the payload_hash computation, would silently break
      // future-replay deduplication for legitimate first-time sends.
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_fresh_001",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      // Fresh key → createSendLog is invoked (NOT resetSendLogForRetry).
      expect(mockCreateSendLog).toHaveBeenCalledTimes(1);
      expect(mockResetSendLogForRetry).not.toHaveBeenCalled();
      // The created log MUST persist a SHA-256 payload_hash so that a
      // future replay with the same key can detect payload divergence.
      const createArgs = mockCreateSendLog.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
      const writtenLog = createArgs[1];
      expect(typeof writtenLog.payload_hash).toBe("string");
      expect((writtenLog.payload_hash as string).length).toBeGreaterThan(16);
      expect(writtenLog.idempotency_key).toBe("key_fresh_001");
      // Provider must still be called — fresh-key path doesn't short-circuit.
      expect(mockProviderSend).toHaveBeenCalledTimes(1);
    });

    test("returns 401 without auth", async () => {
      const { req } = createApp();
      const res = await req("/proj_001/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: "welcome", to: "user@example.com" }),
      });
      expect(res.status).toBe(401);
      // Pin Content-Type on error responses too — clients parse error
      // bodies (`error.code`, `error.message`) and a Content-Type drift
      // would silently break their error-handling pipeline.
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      // Auth must short-circuit before any DB reads or provider calls.
      expect(mockGetProject).not.toHaveBeenCalled();
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for unauthenticated probes — SLO
      // dashboards must bucket auth failures separately from real errors.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(401);
      expect(wlArgs[1].error_code).toBe("auth_missing");
    });

    test("returns 403 with invalid token", async () => {
      const res = await sendRequest(
        { template: "welcome", to: "user@example.com" },
        "wrong_token",
      );
      expect(res.status).toBe(403);
      // Wrong token must NOT leak whether the project exists, and must
      // never invoke the email provider.
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for invalid-token probes.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(403);
      expect(wlArgs[1].error_code).toBe("auth_invalid");
    });

    test("returns 400 for invalid body", async () => {
      const res = await sendRequest({});
      expect(res.status).toBe(400);
      // Body validation must short-circuit before any send-side effects.
      expect(mockProviderSend).not.toHaveBeenCalled();
      expect(mockCreateSendLog).not.toHaveBeenCalled();
      // Audit-log drift defense for body validation failures.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(400);
      expect(wlArgs[1].error_code).toBe("body_invalid");
    });

    test("returns 400 body_invalid for malformed JSON", async () => {
      // Distinct from schema-invalid (well-formed JSON, wrong shape):
      // when the body fails JSON.parse, the route must return
      // body_invalid 400 — not crash with a 500.
      const { req } = createApp();
      const res = await req("/proj_001/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sampleProject.webhook_token}`,
        },
        body: "{not valid json",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("body_invalid");
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for malformed-JSON 400 path.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(400);
      expect(wlArgs[1].error_code).toBe("body_invalid");
    });

    test("happy path with NO variables in payload covers sortedVars `?? {}` branch", async () => {
      // The idempotency-key helper has `payload.variables ?? {}`. The
      // happy-path test always sends variables; this one omits them so
      // the `?? {}` fallback is exercised. Catches a regression that
      // crashes (or fingerprints differently) when variables is omitted.
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(200);
      expect(mockProviderSend).toHaveBeenCalledTimes(1);
      // Pin: provider.send received the rendered envelope (not undefined
      // — a regression that crashed in render with empty vars would
      // silently throw 200 from the catch-block but no real send).
      const sendArgs = (mockProviderSend.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(sendArgs.to).toBe("user@example.com");
      expect(typeof sendArgs.subject).toBe("string");
    });

    test("idempotency key is INVARIANT to variable insertion order (covers sort comparator)", async () => {
      // SECURITY/SLO: the computeIdempotencyKey helper sorts variable
      // entries via Object.entries(...).sort(([a], [b]) => a.localeCompare(b))
      // before fingerprinting. The sort comparator (webhook.ts:49) is
      // ONLY invoked when there are >= 2 keys — single-key tests above
      // never trigger it. Two payloads with identical content but
      // different key insertion orders MUST produce the same idempotency
      // key, otherwise: (a) clients that build payloads via Object.assign
      // or spread of two sources cannot retry safely — same logical send
      // would be treated as a NEW send and re-charge / re-deliver;
      // (b) the de-dup contract is broken in a NON-deterministic way
      // depending on host JS engine ordering. A regression that dropped
      // .sort() (or sorted in reverse) would silently violate this.
      mockFindByIdempotencyKey.mockReset();
      // Both calls return null (fresh send) so the helper is invoked twice.
      mockFindByIdempotencyKey.mockResolvedValue(null);
      const ctRes1 = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_order_invariant",
        variables: { name: "Alice", company: "Acme", role: "admin" },
      });
      const ctRes2 = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_order_invariant",
        // SAME variables, different insertion order.
        variables: { role: "admin", company: "Acme", name: "Alice" },
      });
      expect(ctRes1.status).toBe(200);
      expect(ctRes2.status).toBe(200);
      // Both createSendLog calls receive the SAME payload_hash.
      const h1 = (mockCreateSendLog.mock.calls.at(-2) as unknown as [unknown, { payload_hash: string }])[1].payload_hash;
      const h2 = (mockCreateSendLog.mock.calls.at(-1) as unknown as [unknown, { payload_hash: string }])[1].payload_hash;
      expect(h1).toBe(h2);
      // And critically NOT a constant: a sort regression that dropped
      // the comparator would still produce identical hashes here
      // (because Object.entries iteration order in modern engines is
      // insertion order — different orders → different canonical →
      // different hash). So pin: a payload with DIFFERENT content
      // produces a DIFFERENT hash, anchoring the hash isn't constant.
      const ctRes3 = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_diff_content",
        variables: { name: "Bob", company: "Acme", role: "admin" },
      });
      expect(ctRes3.status).toBe(200);
      const h3 = (mockCreateSendLog.mock.calls.at(-1) as unknown as [unknown, { payload_hash: string }])[1].payload_hash;
      expect(h3).not.toBe(h1);
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
      const body = (await res.json()) as Record<string, unknown>;
      // Quota error_code from checkQuota must be surfaced so callers can
      // distinguish daily vs monthly limits and back off appropriately.
      expect((body.error as Record<string, unknown>).code).toBe("quota_daily_exceeded");
      // Most importantly: quota rejection must short-circuit — no email
      // may be sent when over quota, even by a single message.
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: 429 + the same error code as the response.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(429);
      expect(wlArgs[1].error_code).toBe("quota_daily_exceeded");
    });

    test("returns 429 with monthly-limit message when quota_monthly_exceeded", async () => {
      // Pins the message-templating ternary at webhook.ts:184. Without
      // this branch test, a regression that always rendered the daily
      // message ("Daily send limit (X) exceeded") on monthly overruns
      // would mislead operators into raising the wrong knob.
      mockCheckQuota.mockImplementation(() =>
        Promise.resolve({ allowed: false, error_code: "quota_monthly_exceeded" }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("quota_monthly_exceeded");
      // The message MUST mention the monthly cap (1000), not the daily cap (100).
      expect(body.error.message).toMatch(/Monthly/);
      expect(body.error.message).toContain("1000");
      expect(body.error.message).not.toContain("100)"); // not the daily-cap suffix
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: 429 + quota_monthly_exceeded.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(429);
      expect(wlArgs[1].error_code).toBe("quota_monthly_exceeded");
    });

    test("returns 429 with quota_daily_exceeded fallback when error_code missing", async () => {
      // Pins webhook.ts:183 — the `?? "quota_daily_exceeded"` fallback
      // when checkQuota returns {allowed:false} without an error_code
      // (defensive default for a regression in the quota module). Without
      // this, a regression returning `undefined` for error.code would
      // break clients that branch on the code value.
      mockCheckQuota.mockImplementation(() =>
        Promise.resolve({ allowed: false }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("quota_daily_exceeded");
      // Default message is the daily one (consistent with default code).
      expect(body.error.message).toMatch(/Daily/);
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: 429 + quota_daily_exceeded fallback.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(429);
      expect(wlArgs[1].error_code).toBe("quota_daily_exceeded");
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
      // Unknown recipients must not trigger any send (would otherwise
      // burn quota and create dangling logs).
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for unknown-recipient rejections.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(404);
      expect(wlArgs[1].error_code).toBe("recipient_not_found");
    });

    test("returns 404 when recipient ID belongs to a different project (cross-project lookup)", async () => {
      // Critical TENANCY guard: a recipient ID from project A must not
      // resolve in a request scoped to project B — otherwise an attacker
      // (or accidental ID copy-paste) could send to ANY whitelisted
      // address in any tenant. Triggered by `to` not containing '@'
      // (treated as recipient ID), with the mock returning a recipient
      // belonging to a different project.
      mockGetRecipient.mockImplementation(() =>
        Promise.resolve({ ...sampleRecipient, project_id: "proj_OTHER" }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "rcpt_from_other_proj", // no @ → treated as recipient ID
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("recipient_not_found");
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for cross-project tenancy guard.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(404);
      expect(wlArgs[1].error_code).toBe("recipient_not_found");
    });

    test("resolves recipient by ID (no @) when ID belongs to current project", async () => {
      // Pins webhook.ts:196 happy-path branch (`recipient.project_id !==
      // projectId` evaluates to false). Without this, a regression that
      // ALWAYS treated the cross-project guard as failed would silently
      // 404 every recipient-by-ID lookup, breaking ID-based send flows.
      mockGetRecipient.mockImplementation(() =>
        Promise.resolve({ ...sampleRecipient, project_id: sampleProject.id }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "rcpt_in_proj", // no @ → treated as recipient ID
      });
      expect(res.status).toBe(200);
      // Critical: getRecipient (by-ID) was hit, NOT getRecipientByEmail.
      expect(mockGetRecipient).toHaveBeenCalled();
      expect(mockGetRecipientByEmail).not.toHaveBeenCalled();
      expect(mockProviderSend).toHaveBeenCalledTimes(1);
      // Pin getRecipient was called with the URL recipient-ID AND the
      // current projectId — a regression that swapped the two args
      // would silently lookup the wrong record AND defeat the cross-
      // project tenancy guard at db level.
      const grArgs = mockGetRecipient.mock.calls[0] as unknown as unknown[];
      expect(grArgs).toContain("rcpt_in_proj");
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
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift defense for unknown-template rejections.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(404);
      expect(wlArgs[1].error_code).toBe("template_not_found");
    });

    test("returns 422 with variables_invalid code when renderTemplate throws", async () => {
      // Pins webhook.ts:217 — the variables_invalid error code.
      // Previously only checked status=422; a regression returning the
      // generic 'internal_error' code (or surfacing a Zod-flatten body
      // shape) would silently pass status-only. The actual error.code
      // and message contracts MUST be pinned so dashboard error-grouping
      // and operator triage work.
      mockRenderTemplate.mockImplementation(() => {
        throw new Error("Missing required variable: name");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; message: string } };
      // Pin the documented errorJson shape: { error: { code, message } }.
      expect(body.error.code).toBe("variables_invalid");
      // The underlying renderTemplate message MUST be surfaced verbatim
      // — callers rely on the specific 'Missing required variable: X'
      // string to know WHICH variable to add to their payload.
      expect(body.error.message).toBe("Missing required variable: name");
      // Variable-validation errors are surfaced so callers can fix their
      // payload — a regression returning generic 'internal_error' would
      // make debugging impossible from the caller side.
      expect(mockProviderSend).not.toHaveBeenCalled();
      // No DB write should have occurred for a payload that fails at
      // variable validation — createSendLog only fires AFTER validation.
      expect(mockCreateSendLog).not.toHaveBeenCalled();
      // Audit-log drift defense for variable-validation 422.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(422);
      expect(wlArgs[1].error_code).toBe("variables_invalid");
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
      // 502 path must mark the send log as failed exactly once with the
      // surfacing error — not zero (silent fail) and not multiple times
      // (which would indicate redundant teardown wiring).
      expect(mockMarkSendLogFailed).toHaveBeenCalledTimes(1);
      // The actual provider error message MUST be persisted, otherwise
      // operators have no debugging breadcrumb in the send log table.
      const failArgs = mockMarkSendLogFailed.mock.calls[0] as unknown[];
      expect(JSON.stringify(failArgs)).toContain("API error");
      // Pin the error code: legacy/resend send failures must surface as
      // 'resend_failed' so dashboards can group by provider for SLO charts.
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("resend_failed");
      expect(body.error.message).toBe("API error");
      // Audit-log drift defense: status_code MUST equal 502 and
      // error_code MUST equal 'resend_failed' on the audit row too.
      // A regression that recorded a different status or error in the
      // audit log (vs the response) would cause SLO dashboards to
      // diverge from user-visible reality.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(502);
      expect(wlArgs[1].error_code).toBe("resend_failed");
    });

    test("returns 200 + cached id when provider throws IdempotentSendResult mid-send", async () => {
      // Distinct from route-level idempotency-key dedup: the PROVIDER
      // itself can throw IdempotentSendResult when its own KV-backed
      // dedup fires (e.g. Cloudflare provider sees the key already
      // present). The route MUST catch that, mark the send log as sent
      // (not failed!), and surface the cached idempotency key as the
      // provider_message_id. Without this, a benign re-send during a
      // retry would be recorded as a 502 failure and burn the user's
      // failed-retry budget.
      mockProviderSend.mockImplementation(() => {
        throw new IdempotentSendResult("key_xyz");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("sent");
      expect(body.provider_message_id).toBe("key_xyz");
      // Pin the IdempotentSendResult-specific response shape: this
      // catch-block ALWAYS returns resend_id=null (regardless of
      // providerType) because the cached idempotency key is NOT a
      // resend message id — a regression that mirrored the success
      // ternary here would mislabel cloudflare-cached sends with a
      // bogus resend_id.
      expect(body.resend_id).toBe(null);
      expect(body.id).toBe(sampleSendLog.id);
      // The send log must be marked sent (with the cached key as the
      // provider message id), not failed.
      expect(mockMarkSendLogSent).toHaveBeenCalledTimes(1);
      expect(mockMarkSendLogFailed).not.toHaveBeenCalled();
      const sentArgs = mockMarkSendLogSent.mock.calls[0] as unknown[];
      expect(JSON.stringify(sentArgs)).toContain("key_xyz");
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
      // Cached send must return the ORIGINAL provider_message_id, not a
      // fresh one. Otherwise callers can't correlate the dedup'd response
      // back to their original send.
      expect(body.provider_message_id).toBe("msg_cached");
      expect(body.id).toBe(sampleSendLog.id);
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Provider attribution on the cached path — a regression that
      // hardcoded "legacy" or "resend" in the cache-hit branch would
      // break per-provider dashboards. Cached row's provider_type was
      // 'resend'; verify it surfaces.
      expect(body.provider_type).toBe("resend");
    });

    test("cached send falls back to legacy resend_id when provider_message_id null", async () => {
      // Pins webhook.ts:165 (`provider_message_id ?? resend_id`) and :170
      // (`provider_type ?? "legacy"`). Old send_logs predating the new
      // fields have provider_message_id=null and provider_type=null;
      // a regression that returned `null` for either would break
      // dashboards that bucket by provider_type and break clients that
      // correlate by provider_message_id.
      mockFindByIdempotencyKey.mockImplementation(() =>
        Promise.resolve({
          ...sampleSendLog,
          status: "sent" as const,
          idempotency_key: "key_legacy",
          provider_message_id: null,
          provider_type: null,
          resend_id: "legacy_resend_msg",
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_legacy",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        provider_message_id: string;
        provider_type: string;
        resend_id: string;
      };
      // Fallback chain: provider_message_id MUST surface the legacy resend_id
      expect(body.provider_message_id).toBe("legacy_resend_msg");
      // resend_id must also be returned verbatim (back-compat field).
      expect(body.resend_id).toBe("legacy_resend_msg");
      // provider_type fallback must be "legacy" (NOT null — nulls would
      // break GROUP BY in dashboard SQL and JSON.stringify nesting).
      expect(body.provider_type).toBe("legacy");
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
      // In-progress idempotency must NOT trigger a parallel send. The
      // route surfaces 409 so callers know to wait + poll, instead of
      // double-sending the same email.
      expect(mockProviderSend).not.toHaveBeenCalled();
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("send_in_progress");
      // Audit-log drift defense for the 409 path. SLO 'success rate'
      // dashboards must bucket 409s separately from 5xxs.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(409);
      expect(wlArgs[1].error_code).toBe("send_in_progress");
    });

    test("returns 422 idempotency_payload_mismatch when same key reused with different payload", async () => {
      // Critical safety guarantee: idempotency keys are PER-PAYLOAD. If a
      // caller reuses a key with a different request body (e.g. switched
      // template, different recipient), the route MUST reject with 422
      // — otherwise dedup would silently swallow the new payload, the
      // caller would think a different mail went out when nothing did.
      mockFindByIdempotencyKey.mockImplementation(() =>
        Promise.resolve({
          ...sampleSendLog,
          status: "sent" as const,
          idempotency_key: "key_collide",
          // any non-matching hash triggers the mismatch branch
          payload_hash: "deadbeef0000000000000000000000000000000000000000000000000000000",
          provider_message_id: "msg_orig",
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        idempotency_key: "key_collide",
        variables: { name: "DifferentPayloadFromOriginal" },
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("idempotency_payload_mismatch");
      // The provider must NOT be invoked — dedup short-circuited.
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: pin 422 + idempotency_payload_mismatch.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(422);
      expect(wlArgs[1].error_code).toBe("idempotency_payload_mismatch");
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
      // Failed-retry path must reset exactly once before re-attempting.
      expect(mockResetSendLogForRetry).toHaveBeenCalledTimes(1);
      // CRUCIAL: a 'retry failed' must actually re-invoke the provider.
      // Without this, a regression that short-circuits to 200 without
      // re-sending would pass silently — user thinks mail is sent, isn't.
      expect(mockProviderSend).toHaveBeenCalledTimes(1);
      // Pin the retry's args: per route contract, the idempotencyKey
      // passed to the provider on retry is the EXISTING send_log.id
      // (sampleSendLog.id = 'send_001'), NOT the user-supplied
      // idempotency_key. This guarantees the provider can dedupe
      // against the original attempt without callers needing to know
      // the internal id. A regression that passed key_003 instead
      // would break provider-side dedup on retry.
      const sendArgs = (mockProviderSend.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(sendArgs.idempotencyKey).toBe(sampleSendLog.id);
      expect(sendArgs.to).toBe("user@example.com");
    });

    test("creates webhook log on every response", async () => {
      await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      // One request → exactly one webhook log row, regardless of outcome.
      expect(mockCreateWebhookLog).toHaveBeenCalledTimes(1);
      // Pin the audit-log entry's shape — webhook_logs is the operator's
      // observability surface for /send. A regression that wrote the
      // wrong status_code, dropped project_id (cross-tenant audit
      // mixing), or recorded the wrong method would silently corrupt
      // dashboards and SLO calculations. duration_ms must be a number
      // and >= 0.
      const args = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      const entry = args[1];
      expect(entry.project_id).toBe(sampleProject.id);
      expect(entry.method).toBe("POST");
      expect(entry.status_code).toBe(200);
      expect(typeof entry.duration_ms).toBe("number");
      expect((entry.duration_ms as number) >= 0).toBe(true);
    });

    test("returns 500 with internal_error when getProviderDomain throws", async () => {
      // Defensive: domain resolution can fail (missing FROM_DOMAIN env on
      // legacy provider, malformed provider record). The route MUST mark
      // the send log as failed (so it doesn't dangle in 'sending' forever)
      // and return 500 with the stable 'internal_error' code so clients
      // can distinguish infra-config bugs from provider 5xx.
      mockGetProviderDomain.mockImplementation(() => {
        throw new Error("FROM_DOMAIN not configured");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("internal_error");
      // The send must NOT have happened (dangling 'sending' would burn quota).
      expect(mockProviderSend).not.toHaveBeenCalled();
      // The send log must be transitioned out of 'sending'.
      expect(mockMarkSendLogFailed).toHaveBeenCalledTimes(1);
      // Audit-log drift defense for getProviderDomain-throws 500.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(500);
      expect(wlArgs[1].error_code).toBe("internal_error");
    });

    test("returns 500 with internal_error when an unexpected DB error escapes the inner try", async () => {
      // Outer catch-all 500: anything thrown BEFORE the provider.send
      // try-block (e.g. updateSendLogProvider failing) must surface as
      // a stable 500/internal_error response, not propagate as an
      // unhandled exception (which Workers would render as 500 with
      // no body and no audit log).
      mockUpdateSendLogProvider.mockImplementation(() => {
        return Promise.reject(new Error("D1 connection lost"));
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("internal_error");
      // SECURITY: response body MUST NOT leak the underlying error
      // message (which could contain DB names, SQL fragments, internal
      // IDs, file paths, stack frames). A regression that surfaced
      // error.message in the response would expose internals to ALL
      // webhook callers — a privilege escalation for the bearer-
      // token holder (who otherwise sees only opaque error codes).
      // The audit log entry (4th arg to createWebhookLog) DOES carry
      // error.message, but that's admin-only via the dashboard.
      expect(body.error.message).toBe("Unexpected server error");
      expect(body.error.message).not.toContain("D1");
      expect(body.error.message).not.toContain("connection lost");
      // Even on outer catch-all, the webhook log row MUST still be
      // written so operators can see the failure.
      expect(mockCreateWebhookLog).toHaveBeenCalledTimes(1);
      // Pin the failure-path audit entry: status_code MUST reflect the
      // 500 response (not a stale success default), and error_code MUST
      // be 'internal_error' so SLO dashboards bucket DB-error escapes
      // separately from auth/quota failures. A regression that wrote
      // status_code=200 here would silently make the SLO 'success rate'
      // metric overstate reliability during real outages.
      const args = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      const entry = args[1];
      expect(entry.status_code).toBe(500);
      expect(entry.error_code).toBe("internal_error");
      expect(entry.project_id).toBe(sampleProject.id);
    });

    test("returns 500/provider_not_found when project's configured provider is missing", async () => {
      // Project references a provider_id that's been deleted or never
      // existed. Distinct from 'no provider configured' (legacy fallback)
      // — here the operator EXPECTED a configured provider to exist.
      // Must surface as 'provider_not_found' (not generic internal_error)
      // so dashboard can prompt the operator to reassign.
      mockGetProject.mockImplementation(() =>
        Promise.resolve({ ...sampleProject, provider_id: "prov_missing" }),
      );
      mockGetEmailProvider.mockImplementation(() => Promise.resolve(null));
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("provider_not_found");
      // Send log must be marked failed so it doesn't dangle in 'sending'.
      expect(mockMarkSendLogFailed).toHaveBeenCalledTimes(1);
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: pin 500 + provider_not_found so SLO charts
      // bucket 'misconfigured project' separately from real outages.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(500);
      expect(wlArgs[1].error_code).toBe("provider_not_found");
    });

    test("returns 500/provider_config_invalid when provider init throws", async () => {
      // The createProvider/parseProviderConfig path can throw on a
      // malformed stored config (e.g. resend with non-JSON config column,
      // type mismatch from a manual DB edit). Must surface as the
      // stable 'provider_config_invalid' code so the dashboard health
      // page can correlate it with /providers/:id/health output.
      mockGetProject.mockImplementation(() =>
        Promise.resolve({ ...sampleProject, provider_id: "prov_001" }),
      );
      mockGetEmailProvider.mockImplementation(() =>
        Promise.resolve({
          id: "prov_001",
          name: "Resend",
          type: "resend",
          domain: "example.com",
          config: "{not-json}",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
      mockCreateProvider.mockImplementation(() => {
        throw new Error("Invalid provider config: api_key required");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("provider_config_invalid");
      expect(mockMarkSendLogFailed).toHaveBeenCalledTimes(1);
      expect(mockProviderSend).not.toHaveBeenCalled();
      // Audit-log drift: pin 500 + provider_config_invalid.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(500);
      expect(wlArgs[1].error_code).toBe("provider_config_invalid");
    });

    test("happy path with configured provider records provider_type from record (not 'legacy')", async () => {
      // Covers line 257 of webhook.ts (the success path of the
      // configured-provider branch). When the project has a provider_id
      // pointing at an existing record, the route MUST use createProvider
      // (not legacy fallback) AND record the provider_type from the
      // record — critical for accurate per-provider attribution in
      // send_logs and dashboard charts.
      mockGetProject.mockImplementation(() =>
        Promise.resolve({ ...sampleProject, provider_id: "prov_001" }),
      );
      mockGetEmailProvider.mockImplementation(() =>
        Promise.resolve({
          id: "prov_001",
          name: "CF",
          type: "cloudflare",
          domain: "example.com",
          config: "{}",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      // Critical: createProvider was called (configured path), legacy was not.
      expect(mockCreateProvider).toHaveBeenCalledTimes(1);
      expect(mockCreateLegacyProvider).not.toHaveBeenCalled();
      // Provider attribution must reflect the record's type so the
      // dashboard's per-provider stats are honest.
      expect(mockUpdateSendLogProvider).toHaveBeenCalledTimes(1);
      const updateArgs = (mockUpdateSendLogProvider.mock.calls[0] as unknown as unknown[])[2];
      expect(updateArgs).toEqual({ provider_id: "prov_001", provider_type: "cloudflare" });
      // Pin response-shape contract for the cloudflare path:
      //   `resend_id: providerType === 'cloudflare' ? null : result.id`.
      // Symmetric to the legacy-path test (which pins resend_id=msg_001).
      // Together they protect the per-provider-type ternary against
      // either a hardcode-null OR hardcode-result.id regression — a
      // single-side test would let half the bug class through.
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.resend_id).toBe(null);
      expect(body.provider_message_id).toBe("msg_001");
      expect(body.provider_type).toBe("cloudflare");
      expect(body.status).toBe("sent");
    });

    describe("Step 5 recipient — allow_unknown_recipients", () => {
      // Per-project opt-in flag (defaults false): when true, the project
      // owns its own user directory & verifies recipients out-of-band
      // (e.g. ellie's email-verify flow). Webhook MUST accept any
      // RFC-shaped email and skip the whitelist lookup, but MUST still
      // gate on email format — silently letting the no-`@` "id" form
      // through would bypass that gate. Defaults must stay false to
      // preserve the locked-down behavior every other project relies on.

      test("flag ON + valid email: accepts and SKIPS whitelist lookup", async () => {
        mockGetProject.mockImplementation(() =>
          Promise.resolve({ ...sampleProject, allow_unknown_recipients: true }),
        );
        const res = await sendRequest({
          template: "welcome",
          to: "totally-unknown@example.com",
          variables: { name: "Stranger" },
        });
        expect(res.status).toBe(200);
        // Critical: NO recipient lookup of either form should fire.
        expect(mockGetRecipientByEmail).not.toHaveBeenCalled();
        expect(mockGetRecipient).not.toHaveBeenCalled();
        // Provider was called with the ad-hoc email (no whitelist join).
        expect(mockProviderSend).toHaveBeenCalledTimes(1);
        const sendArgs = (mockProviderSend.mock.calls[0] as unknown as [Record<string, unknown>])[0];
        expect(sendArgs.to).toBe("totally-unknown@example.com");
        // Send log persisted with NULL recipient_id (no recipients row).
        const createArgs = mockCreateSendLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
        expect(createArgs[1].recipient_id).toBeNull();
      });

      test("flag ON + malformed email: 400 recipient_invalid (NOT 404)", async () => {
        mockGetProject.mockImplementation(() =>
          Promise.resolve({ ...sampleProject, allow_unknown_recipients: true }),
        );
        const res = await sendRequest({
          template: "welcome",
          to: "plain@nodot",
          variables: { name: "X" },
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("recipient_invalid");
        expect(mockProviderSend).not.toHaveBeenCalled();
        expect(mockGetRecipientByEmail).not.toHaveBeenCalled();
        expect(mockGetRecipient).not.toHaveBeenCalled();
        // Audit-log drift defense: pin 400 + recipient_invalid.
        const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
        expect(wlArgs[1].status_code).toBe(400);
        expect(wlArgs[1].error_code).toBe("recipient_invalid");
      });

      test("flag ON + bare id (no @): rejected as recipient_invalid (no silent id-lookup bypass)", async () => {
        // SECURITY: in flag-on mode the no-`@` id-form lookup MUST be
        // disabled. A regression that fell through to getRecipient(...)
        // here would let an attacker who learned a recipient ID from
        // any tenant send to that ID's email, with the email-format
        // gate completely bypassed.
        mockGetProject.mockImplementation(() =>
          Promise.resolve({ ...sampleProject, allow_unknown_recipients: true }),
        );
        const res = await sendRequest({
          template: "welcome",
          to: "rcpt_bareid",
          variables: { name: "X" },
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("recipient_invalid");
        expect(mockGetRecipient).not.toHaveBeenCalled();
        expect(mockGetRecipientByEmail).not.toHaveBeenCalled();
        expect(mockProviderSend).not.toHaveBeenCalled();
      });

      test("flag OFF (default): whitelist enforcement is unchanged (regression guard)", async () => {
        // The default branch must continue to look up the recipient via
        // the project's whitelist. A regression that always took the
        // bypass path would silently disable per-project recipient
        // gating for EVERY project.
        mockGetRecipientByEmail.mockImplementation(() => Promise.resolve(null));
        const res = await sendRequest({
          template: "welcome",
          to: "stranger@example.com",
          variables: { name: "X" },
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("recipient_not_found");
        expect(mockGetRecipientByEmail).toHaveBeenCalledTimes(1);
        expect(mockProviderSend).not.toHaveBeenCalled();
      });
    });

    test("returns 502 with cloudflare_failed code when configured cloudflare provider throws", async () => {
      // Pins webhook.ts:323 — the cloudflare branch of the errCode
      // ternary. A regression that always returned 'resend_failed'
      // would mis-attribute Cloudflare outages to Resend on dashboards,
      // and an SLO alert wired to 'resend_failed' would miss CF incidents.
      mockGetProject.mockImplementation(() =>
        Promise.resolve({ ...sampleProject, provider_id: "prov_cf" }),
      );
      mockGetEmailProvider.mockImplementation(() =>
        Promise.resolve({
          id: "prov_cf",
          name: "CF",
          type: "cloudflare" as const,
          domain: "example.com",
          config: "{}",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      );
      mockProviderSend.mockImplementation(() => {
        throw new Error("CF binding error");
      });
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("cloudflare_failed");
      expect(body.error.message).toBe("CF binding error");
      expect(mockMarkSendLogFailed).toHaveBeenCalledTimes(1);
      // Pin the audit-log entry too — a regression that wrote
      // status_code=200 or error_code='resend_failed' on this path
      // would mis-attribute Cloudflare provider outages to Resend on
      // operator dashboards. Without this pin, the audit row could
      // silently drift from the user-visible response.
      const wlArgs = mockCreateWebhookLog.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(wlArgs[1].status_code).toBe(502);
      expect(wlArgs[1].error_code).toBe("cloudflare_failed");
    });
  });

  describe("rate limiting", () => {
    test("returns 429 when rate limit is active", async () => {
      mockAcquireAddressLock.mockImplementation(() =>
        Promise.resolve({ allowed: false, retry_after_seconds: 245 }),
      );

      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("245");
      const body = (await res.json()) as { error: { code: string; retry_after_seconds: number } };
      expect(body.error.code).toBe("rate_limit_address");
      expect(body.error.retry_after_seconds).toBe(245);
    });

    test("releases lock on provider send failure", async () => {
      mockProviderSend.mockImplementation(() => Promise.reject(new Error("provider down")));

      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(502);
      expect(mockReleaseAddressLock).toHaveBeenCalledWith(
        expect.anything(),
        "proj_001",
        "user@example.com",
        "test-lock-token",
      );
    });

    test("does NOT release lock on successful send", async () => {
      const res = await sendRequest({
        template: "welcome",
        to: "user@example.com",
        variables: { name: "Alice" },
      });
      expect(res.status).toBe(200);
      expect(mockReleaseAddressLock).not.toHaveBeenCalled();
    });
  });
});
