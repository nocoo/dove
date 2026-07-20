import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { IdempotentSendResult } from "../../../lib/email/providers/cloudflare";
import type { Env } from "../../env";

// Heavy-mock isolated tests for POST /:id/test-send. The lightweight
// `routes-templates.test.ts` covers the cheap short-circuit paths
// (404/400) where no provider work happens; this file mocks ALL the
// transitive dependencies so we can exercise the happy-path send,
// IdempotentSendResult catch, and outer 500 catch-all.

const sampleTemplate = {
	id: "tpl_001",
	project_id: "proj_001",
	name: "Welcome",
	slug: "welcome",
	subject: "Hello {{name}}",
	body_markdown: "Hi **{{name}}**!",
	variables: JSON.stringify([{ name: "name", type: "string", required: true }]),
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

const sampleProject = {
	id: "proj_001",
	name: "Acme",
	description: null,
	email_prefix: "noreply",
	from_name: "Acme Inc",
	webhook_token: "tok_xxx",
	quota_daily: 100,
	quota_monthly: 1000,
	provider_id: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

const mockGetTemplate = vi.fn<() => Promise<unknown>>(() => Promise.resolve(sampleTemplate));
const mockGetProject = vi.fn<() => Promise<unknown>>(() => Promise.resolve(sampleProject));
const mockProviderSend = vi.fn(() => Promise.resolve({ id: "msg_001" }));
const mockCreateLegacyProvider = vi.fn<() => Promise<unknown>>(() =>
	Promise.resolve({
		type: "resend" as const,
		send: mockProviderSend,
		supportsDryRun: () => true,
		setDryRun: () => {},
	}),
);
const mockGetProviderDomain = vi.fn(() => "example.com");
const mockRenderTemplate = vi.fn(() =>
	Promise.resolve({ subject: "Hello Alice", html: "<p>Hi <b>Alice</b>!</p>" }),
);

const mockGetEmailProvider = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));
const mockCreateProvider = vi.fn<() => Promise<unknown>>(() =>
	Promise.resolve({
		type: "resend" as const,
		send: mockProviderSend,
		supportsDryRun: () => true,
		setDryRun: () => {},
	}),
);

vi.mock("../../lib/db/templates", () => ({
	getTemplate: mockGetTemplate,
	parseVariables: vi.fn(() => []),
	// unused but referenced at module-load:
	listTemplates: vi.fn(),
	listAllTemplates: vi.fn(),
	createTemplate: vi.fn(),
	updateTemplate: vi.fn(),
	deleteTemplate: vi.fn(),
}));
vi.mock("../../lib/db/projects", () => ({ getProject: mockGetProject }));
vi.mock("../../lib/db/email-providers", () => ({
	getEmailProvider: mockGetEmailProvider,
}));
vi.mock("../../lib/email/provider", () => ({
	createProvider: mockCreateProvider,
	createLegacyProvider: mockCreateLegacyProvider,
	parseProviderConfig: vi.fn(() => ({})),
	getProviderDomain: mockGetProviderDomain,
}));
vi.mock("@/lib/email/render", () => ({ renderTemplate: mockRenderTemplate }));
vi.mock("@/lib/id", () => ({ generateId: () => "id_test" }));

beforeEach(() => {
	vi.clearAllMocks();
	mockGetTemplate.mockImplementation(() => Promise.resolve(sampleTemplate));
	mockGetProject.mockImplementation(() => Promise.resolve(sampleProject));
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
	mockRenderTemplate.mockImplementation(() =>
		Promise.resolve({ subject: "Hello Alice", html: "<p>Hi <b>Alice</b>!</p>" }),
	);
});

async function loadApp() {
	const { templates } = await import("../../routes/templates");
	const app = new Hono<{ Bindings: Env }>();
	app.route("/", templates);
	return {
		req: (path: string, init?: RequestInit) =>
			app.request(path, init, { DB: {} as unknown as D1Database } as unknown as Env),
	};
}

describe("templates /:id/test-send (isolated)", () => {
	test("happy path: returns 200 + provider_type and invokes provider.send with rendered subject/html", async () => {
		const { req } = await loadApp();
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "alice@example.com", variables: { name: "Alice" } }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; provider_type: string };
		expect(body.status).toBe("sent");
		expect(body.provider_type).toBe("legacy");
		// provider.send must be invoked exactly once with the rendered output
		// and the constructed from-address (project.from_name <prefix@domain>).
		expect(mockProviderSend).toHaveBeenCalledTimes(1);
		const args = (mockProviderSend.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(args.from).toBe("Acme Inc <noreply@example.com>");
		expect(args.to).toBe("alice@example.com");
		expect(args.subject).toBe("Hello Alice");
		expect(args.html).toBe("<p>Hi <b>Alice</b>!</p>");
		// generateId must produce a fresh idempotency key per call.
		expect(args.idempotencyKey).toBe("id_test");
	});

	test("returns 200 when provider throws IdempotentSendResult (cached send)", async () => {
		// Provider-level dedup fired (e.g. Cloudflare KV saw the key). The
		// route MUST treat this as a successful send (not a 500) and return
		// status='sent', NOT bubble the error to the catch-all.
		mockProviderSend.mockImplementation(() => {
			throw new IdempotentSendResult("key_dedup");
		});
		const { req } = await loadApp();
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "alice@example.com", variables: { name: "Alice" } }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; provider_type: string };
		expect(body.status).toBe("sent");
		// Pin provider_type too — a regression that dropped it from the
		// cached-send branch (e.g. forgot to surface it in the catch block)
		// would silently break dashboards that show which provider handled
		// the send. Default test fixture is 'legacy' (no provider_id set).
		expect(body.provider_type).toBe("legacy");
		// The provider.send call count MUST be exactly 1 even though it
		// threw — a regression that retried after IdempotentSendResult
		// (treating it as a real error) would invoke send a second time
		// and could double-charge the underlying API.
		expect(mockProviderSend).toHaveBeenCalledTimes(1);
		// Pin the args of the (one) attempt: even though it threw, the
		// SUT must have built the right envelope BEFORE throwing — a
		// regression that called send with empty/wrong args and the
		// provider's KV-dedup happened to throw IdempotentSendResult on
		// an unrelated key would falsely succeed and surface the wrong key.
		const sendArgs = (mockProviderSend.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(sendArgs.to).toBe("alice@example.com");
	});

	test("returns 500 with surfaced error message when provider.send throws non-idempotent", async () => {
		// Outer try/catch: any non-IdempotentSendResult error from the send
		// pipeline must surface as 500 with the actual error message in the
		// body, so operators can see why the test-send failed.
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		mockProviderSend.mockImplementation(() => {
			throw new Error("provider 4xx: bad domain");
		});
		const { req } = await loadApp();
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "alice@example.com", variables: { name: "Alice" } }),
		});
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("provider 4xx: bad domain");
		errSpy.mockRestore();
	});

	test("omitted `variables` falls through to {} (covers ?? branch at templates.ts:177)", async () => {
		// Pins templates.ts:177 — `parsed.data.variables ?? {}`. Body omits
		// `variables` entirely; renderTemplate is mocked to succeed without
		// them so the happy-path send still completes. Without this, a
		// regression dropping `?? {}` would surface variables=undefined to
		// renderTemplate — most templates would crash with TypeError instead
		// of the documented behavior.
		const { req } = await loadApp();
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "alice@example.com" }), // no variables
		});
		expect(res.status).toBe(200);
		expect(mockProviderSend).toHaveBeenCalledTimes(1);
		// renderTemplate must have been invoked with an empty-object variables
		// arg — NOT undefined or null. The 4th positional is `variables`.
		const renderArgs = mockRenderTemplate.mock.calls[0] as unknown as unknown[];
		expect(renderArgs[3]).toEqual({});
	});

	test("configured provider path: uses createProvider and surfaces provider_type from record", async () => {
		// When project.provider_id is set, the route MUST use the configured
		// provider (createProvider), not fall back to legacy. The returned
		// provider_type must reflect the actual provider record's type so
		// dashboards can attribute sends correctly.
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
		mockCreateProvider.mockImplementation(() =>
			Promise.resolve({
				type: "cloudflare" as const,
				send: mockProviderSend,
				supportsDryRun: () => false,
				setDryRun: () => {},
			}),
		);
		const { req } = await loadApp();
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "alice@example.com", variables: { name: "Alice" } }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; provider_type: string };
		expect(body.status).toBe("sent");
		// Critical: provider_type must come from the record, not fallback to 'legacy'.
		expect(body.provider_type).toBe("cloudflare");
		expect(mockCreateProvider).toHaveBeenCalledTimes(1);
		expect(mockCreateLegacyProvider).not.toHaveBeenCalled();
		// Pin createProvider got the parsed-provider-config wrapping the
		// configured record (it's called with parseProviderConfig(record),
		// env.EMAIL, env.DB — args[0] is the parsed config object). A
		// regression that passed an empty/default config (e.g. lookup by
		// wrong projectId) would build the wrong provider type silently.
		const cpArgs = mockCreateProvider.mock.calls[0] as unknown as unknown[];
		expect(cpArgs[0]).toBeDefined();
		// The first positional MUST exist (the parsed record/config). The
		// exact shape of parseProviderConfig output is exercised in
		// provider-schema.test — here we just defend against `undefined`
		// being passed (e.g. parseProviderConfig wired to wrong source).
		expect(typeof cpArgs[0]).toBe("object");
	});
});
