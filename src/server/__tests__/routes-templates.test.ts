import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import { templates } from "../routes/templates";

const sampleTemplate = {
	id: "tpl_001",
	project_id: "proj_001",
	name: "Welcome",
	slug: "welcome",
	subject: "Hello {{name}}",
	body_markdown: "Hi **{{name}}**!",
	variables: JSON.stringify([{ name: "name", type: "string", required: true }]),
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
};

function createMockDB(
	opts: {
		allResults?: unknown[];
		firstResult?: unknown;
		firstResults?: unknown[];
		sqlSeen?: string[];
		bindsSeen?: unknown[][];
	} = {},
) {
	const { allResults = [], firstResult = null, firstResults, sqlSeen, bindsSeen } = opts;
	let firstCallIdx = 0;
	return {
		prepare: vi.fn((sql: string) => {
			sqlSeen?.push(sql);
			return {
				bind: vi.fn((...args: unknown[]) => {
					bindsSeen?.push(args);
					return {
						all: vi.fn(() => Promise.resolve({ results: allResults })),
						first: vi.fn(() => {
							if (firstResults) {
								const v = firstResults[firstCallIdx] ?? null;
								firstCallIdx += 1;
								return Promise.resolve(v);
							}
							return Promise.resolve(firstResult);
						}),
						run: vi.fn(() => Promise.resolve({ success: true, meta: {}, results: [] })),
					};
				}),
			};
		}),
	} as unknown as D1Database;
}

function createApp(db: D1Database) {
	const app = new Hono<{ Bindings: Env }>();
	app.route("/", templates);
	return {
		req: (path: string, init?: RequestInit) =>
			app.request(path, init, { DB: db } as unknown as Env),
	};
}

describe("templates route handlers", () => {
	test("GET / returns all templates", async () => {
		const { req } = createApp(createMockDB({ allResults: [sampleTemplate] }));
		const res = await req("/");
		expect(res.status).toBe(200);
		const body = (await res.json()) as unknown[];
		expect(body).toHaveLength(1);
	});

	test("GET /?projectId= filters by project (binds projectId to SQL)", async () => {
		// Strengthened: pin that projectId is actually bound to the SELECT.
		// Without this, a regression that dropped the WHERE clause would
		// silently return ALL templates across ALL tenants — a cross-tenant
		// data leak that the bare result-length assertion would never catch
		// (mock returns the same row regardless of filter).
		const bindCalls: unknown[][] = [];
		const sqlCalls: string[] = [];
		const db = {
			prepare: vi.fn((sql: string) => {
				sqlCalls.push(sql);
				return {
					bind: vi.fn((...params: unknown[]) => {
						bindCalls.push(params);
						return {
							all: vi.fn(() => Promise.resolve({ results: [sampleTemplate] })),
							first: vi.fn(() => Promise.resolve(null)),
							run: vi.fn(() => Promise.resolve({ success: true })),
						};
					}),
				};
			}),
		} as unknown as D1Database;
		const app = new Hono<{ Bindings: Env }>();
		app.route("/", templates);
		const res = await app.request("/?projectId=proj_001", {}, { DB: db } as unknown as Env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as unknown[];
		expect(body).toHaveLength(1);
		// The filter value MUST be bound, AND the issued SQL MUST contain a
		// project_id WHERE clause — catches both "forgot to call .bind" and
		// "forgot to add WHERE" regressions.
		expect(bindCalls.flat()).toContain("proj_001");
		expect(sqlCalls.some((s) => /project_id/i.test(s))).toBe(true);
	});

	test("POST / creates template 201", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "p1",
				name: "New",
				slug: "new-template",
				subject: "Hi",
				body_markdown: "Hello",
			}),
		});
		expect(res.status).toBe(201);
		// Body must echo the created template (not just status). A regression
		// returning empty would strand the dashboard's optimistic UI.
		const body = (await res.json()) as {
			id: string;
			project_id: string;
			slug: string;
			name: string;
			subject: string;
			body_markdown: string;
		};
		expect(body.slug).toBe("new-template");
		expect(body.name).toBe("New");
		// Pin the OTHER documented response fields too — a regression
		// returning only {slug, name} (e.g. accidental .pick or wrong
		// sanitize) would silently pass the bare 2-field check while
		// breaking dashboards that need id (to navigate to the new row),
		// project_id (to route), and the rendered subject/body_markdown.
		expect(body.id).toHaveLength(21); // server-generated nanoid
		expect(body.project_id).toBe("p1");
		expect(body.subject).toBe("Hi");
		expect(body.body_markdown).toBe("Hello");
	});

	test("POST / returns 400 for invalid slug", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "p1",
				name: "New",
				slug: "INVALID SLUG",
				subject: "Hi",
				body_markdown: "Hello",
			}),
		});
		expect(res.status).toBe(400);
		// Critical: the 400 must surface 'Invalid input' (not crash with a
		// confusing message) AND must include details so the UI can point
		// the operator at which field failed validation.
		const body = (await res.json()) as { error: string; details: unknown };
		expect(body.error).toMatch(/invalid input/i);
		expect(body.details).toBeDefined();
	});

	test("POST / returns 409 when slug already exists in project (UNIQUE constraint)", async () => {
		// Templates are addressed by slug from the webhook (POST /<project>/send
		// with template: "welcome"). A duplicate slug is not a 500 — it must
		// surface as 409 so the operator gets a meaningful UI error instead
		// of a generic crash, and the existing template is left intact.
		const dbThatThrowsUnique = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(null)),
					run: vi.fn(() =>
						Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: templates.slug")),
					),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(dbThatThrowsUnique);
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "p1",
				name: "Welcome",
				slug: "welcome",
				subject: "Hi",
				body_markdown: "Hello",
			}),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/slug already exists/i);
	});

	test("GET /:id returns template (full documented shape)", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.slug).toBe("welcome");
		// Pin the rest of the documented shape — a regression returning a
		// partial object would silently break dashboard preview/edit pages
		// that need every field. Includes id, project_id (routing), and
		// body_markdown / variables (preview rendering).
		expect(body.id).toBe("tpl_001");
		expect(body.project_id).toBe("proj_001");
		expect(body.name).toBe("Welcome");
		expect(body.subject).toBe("Hello {{name}}");
		expect(body.body_markdown).toBe("Hi **{{name}}**!");
		expect(typeof body.variables).toBe("string");
	});

	test("GET /:id returns 404 when not found", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/missing");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Template not found");
	});

	test("PUT /:id updates template (full shape, not just updated field)", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.name).toBe("Updated");
		// Pin the rest of the documented shape on PUT response too.
		expect(body.id).toBe("tpl_001");
		expect(body.project_id).toBeDefined();
		expect(body.slug).toBeDefined();
		expect(body.subject).toBeDefined();
		expect(body.body_markdown).toBeDefined();
	});

	test("PUT /:id returns 400 for malformed body (line 91)", async () => {
		// Schema short-circuit on PUT — must reject before any DB write.
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: 123 }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; details: unknown };
		expect(body.error).toMatch(/invalid input/i);
		expect(body.details).toBeDefined();
	});

	test("POST / propagates non-UNIQUE DB errors (line 77 rethrow)", async () => {
		// The catch block in POST narrowly handles UNIQUE→409. Any OTHER
		// DB error MUST be rethrown so Hono surfaces it as 500 with an
		// audit trail — not silently squashed into a misleading 409.
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const dbThatThrowsGeneric = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(null)),
					run: vi.fn(() => Promise.reject(new Error("D1_ERROR: disk full"))),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(dbThatThrowsGeneric);
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "proj_001",
				slug: "new-slug",
				name: "X",
				subject: "S",
				body_markdown: "B",
			}),
		});
		expect(res.status).toBe(500);
		// The non-UNIQUE error must surface (not be silently mapped to 409).
		// Hono logs to console.error on uncaught exceptions — prove that the
		// rethrow actually reached Hono's handler (proves the catch DID NOT
		// swallow it under a misleading 409).
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	test("PUT /:id propagates non-UNIQUE DB errors (line 101 rethrow)", async () => {
		// Symmetric to POST: PUT's catch must not swallow generic DB errors.
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const db = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(sampleTemplate)),
					run: vi.fn(() => Promise.reject(new Error("D1_ERROR: timeout"))),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/tpl_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(500);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	test("PUT /:id returns 409 when changing slug collides with existing", async () => {
		// Symmetric to POST 409: editing a template's slug to a value that
		// already exists in the project must return 409, not 500. Otherwise
		// operators see a generic crash and the existing template stays
		// pointed-to by webhook callers under the conflicting slug.
		const dbThatThrowsUniqueOnUpdate = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(sampleTemplate)),
					run: vi.fn(() =>
						Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: templates.slug")),
					),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(dbThatThrowsUniqueOnUpdate);
		const res = await req("/tpl_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "existing-slug" }),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/slug already exists/i);
	});

	test("DELETE /:id returns 204 AND issues DELETE SQL with bound id (silent-no-op defense)", async () => {
		const sqlSeen: string[] = [];
		const bindsSeen: unknown[][] = [];
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate, sqlSeen, bindsSeen }));
		const res = await req("/tpl_001", { method: "DELETE" });
		expect(res.status).toBe(204);
		const text = await res.text();
		expect(text).toBe("");
		// Defends silent-no-op: a regression that returned 204 WITHOUT
		// issuing the DELETE SQL would leave templates in DB while clients
		// believed they were removed (cascading: orphan send_logs reference
		// a 'deleted' template that still exists, breaking GDPR delete
		// requests AND admin's ability to recreate with the same slug).
		const deleteSqls = sqlSeen.filter((s) => /DELETE\s+FROM\s+templates/i.test(s));
		expect(deleteSqls.length).toBeGreaterThanOrEqual(1);
		expect(deleteSqls[0]).toMatch(/WHERE\s+id\s*=\s*\?/i);
		const deleteBind = bindsSeen.find((b) => b[0] === "tpl_001");
		expect(deleteBind).toBeDefined();
	});

	test("DELETE /:id returns 404 when template missing (line 107 !deleted branch)", async () => {
		// Pins templates.ts:107 — the !deleted return path. Without this,
		// a regression where deleteTemplate silently swallows missing rows
		// (e.g. DELETE FROM ... WHERE id=? returning 0 affected rows treated
		// as success) would respond 204 for non-existent IDs, hiding either
		// an attacker probing IDs or a CLI typo.
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/tpl_missing", { method: "DELETE" });
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Template not found");
	});

	test("PUT /:id returns 404 when template missing (line 95 !updated branch)", async () => {
		// Pins templates.ts:95 — the !updated return path. Same class as
		// DELETE 404: a missing template must NOT silently 200 with a
		// stale/empty body.
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/tpl_missing", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Renamed" }),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Template not found");
	});

	test("POST /:id/preview returns 404 for missing template", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/missing/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Template not found");
	});

	test("POST /:id/preview renders template", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ variables: { name: "Alice" } }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { subject: string; html: string };
		expect(body.subject).toBe("Hello Alice");
		expect(body.html).toContain("Alice");
	});

	test("POST /:id/preview returns 400 when variables is not an object", async () => {
		// Schema validation must reject malformed `variables` input. Without
		// this, downstream renderTemplate would try to iterate a non-object
		// and crash with a confusing message.
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ variables: "not-a-record" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("POST /:id/preview returns 422 when render fails (missing required variable)", async () => {
		// The preview endpoint catches render errors and surfaces them as
		// 422 with the actual error message, so the dashboard preview UI
		// can show the operator exactly what's wrong with their template
		// (e.g. missing required variable, type coercion failure).
		// Body omits `variables` entirely — the route's `?? {}` fall-through
		// (templates.ts:123) must produce the same behavior as `variables: {}`.
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}), // no variables — hits ?? {} fall-through
		});
		expect(res.status).toBe(422);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/name|required/i);
	});

	test("POST /:id/test-send returns 404 when template missing", async () => {
		// The /test-send endpoint had ZERO tests before — noticed when probing
		// coverage scope (#68 found 86.87% real route coverage). Cover the
		// simplest short-circuit path first: template not found.
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/missing/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "user@example.com" }),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/template not found/i);
	});

	test("POST /:id/test-send returns 400 for invalid input", async () => {
		// Schema validation must short-circuit before any provider work,
		// otherwise a malformed body could leak into the send pipeline.
		const { req } = createApp(createMockDB({ firstResult: sampleTemplate }));
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}), // missing 'to'
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("POST /:id/test-send returns 500 when project not found for template", async () => {
		// Defensive 500: orphan template (project_id points to a deleted
		// project) must surface clearly, not silently fall through to the
		// provider with undefined project context. Sequenced firstResults:
		// [template found, project lookup returns null].
		const { req } = createApp(createMockDB({ firstResults: [sampleTemplate, null] }));
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "user@example.com", variables: { name: "A" } }),
		});
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/project not found/i);
	});

	test("POST /:id/test-send returns 500 when configured provider missing", async () => {
		// Critical safety path: project references a provider that's been
		// deleted out from under it (or never existed). Without this guard
		// the route would call createProvider(null) and crash with a less
		// actionable error. Sequenced firstResults: [template, project with
		// provider_id, provider lookup returns null].
		const projectWithProvider = {
			id: "proj_001",
			name: "Acme",
			description: null,
			email_prefix: "noreply",
			from_name: "Acme Inc",
			webhook_token: "tok_xxx",
			quota_daily: 100,
			quota_monthly: 1000,
			provider_id: "prov_missing",
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:00:00Z",
		};
		const { req } = createApp(
			createMockDB({ firstResults: [sampleTemplate, projectWithProvider, null] }),
		);
		const res = await req("/tpl_001/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ to: "user@example.com", variables: { name: "A" } }),
		});
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/configured email provider not found/i);
	});
});
