import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import { recipients } from "../routes/recipients";

const sampleRecipient = {
	id: "rec_001",
	project_id: "proj_001",
	name: "Alice",
	email: "alice@example.com",
	created_at: "2026-01-01T00:00:00.000Z",
};

function createMockDB(
	opts: {
		allResults?: unknown[];
		firstResult?: unknown;
		sqlSeen?: string[];
		bindsSeen?: unknown[][];
	} = {},
) {
	const { allResults = [], firstResult = null, sqlSeen, bindsSeen } = opts;
	return {
		prepare: vi.fn((sql: string) => {
			sqlSeen?.push(sql);
			return {
				bind: vi.fn((...args: unknown[]) => {
					bindsSeen?.push(args);
					return {
						all: vi.fn(() => Promise.resolve({ results: allResults })),
						first: vi.fn(() => Promise.resolve(firstResult)),
						run: vi.fn(() => Promise.resolve({ success: true, meta: {}, results: [] })),
					};
				}),
			};
		}),
	} as unknown as D1Database;
}

function createApp(db: D1Database) {
	const app = new Hono<{ Bindings: Env }>();
	app.route("/", recipients);
	return {
		req: (path: string, init?: RequestInit) =>
			app.request(path, init, { DB: db } as unknown as Env),
	};
}

describe("recipients route handlers", () => {
	test("GET / requires projectId", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/projectId/i);
	});

	test("GET /?projectId= returns list (binds projectId to SQL)", async () => {
		// Strengthened: pin that projectId is actually bound + that the
		// SELECT contains a project_id WHERE clause. Without these, a
		// regression dropping the WHERE would silently leak ALL recipients
		// across ALL tenants — a result-length assertion alone (mock returns
		// the same row regardless) would never catch it.
		const bindCalls: unknown[][] = [];
		const sqlCalls: string[] = [];
		const db = {
			prepare: vi.fn((sql: string) => {
				sqlCalls.push(sql);
				return {
					bind: vi.fn((...params: unknown[]) => {
						bindCalls.push(params);
						return {
							all: vi.fn(() => Promise.resolve({ results: [sampleRecipient] })),
							first: vi.fn(() => Promise.resolve(null)),
							run: vi.fn(() => Promise.resolve({ success: true })),
						};
					}),
				};
			}),
		} as unknown as D1Database;
		const app = new Hono<{ Bindings: Env }>();
		app.route("/", recipients);
		const res = await app.request("/?projectId=proj_001", {}, { DB: db } as unknown as Env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as unknown[];
		expect(body).toHaveLength(1);
		expect(bindCalls.flat()).toContain("proj_001");
		expect(sqlCalls.some((s) => /project_id/i.test(s))).toBe(true);
	});

	test("POST / creates recipient 201", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ project_id: "p1", name: "Bob", email: "bob@x.com" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			id: string;
			project_id: string;
			name: string;
			email: string;
		};
		expect(body.name).toBe("Bob");
		expect(body.email).toBe("bob@x.com");
		// Pin id (server-generated) + project_id (routing key) too — a
		// regression returning only {name, email} would strand dashboards
		// that need to navigate to the new row or attribute it to a project.
		expect(body.id).toHaveLength(21);
		expect(body.project_id).toBe("p1");
	});

	test("POST / returns 400 for invalid input", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ project_id: "p1" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("POST / SECURITY: rejects email with CR/LF (header-injection defense at API boundary)", async () => {
		// First-line defense against MIME header injection: recipient.email
		// flows directly into outbound `To:` headers without RFC 2047
		// encoding (it MUST be a valid address, not an arbitrary string).
		// A regression that loosened the email validator to z.string() (e.g.
		// chasing wider compatibility with edge-case formats) would let an
		// attacker create a recipient with embedded \r\n and force the
		// outbound MIME envelope to carry an injected Bcc / X-header.
		// Pin: z.email() rejects \r\n at the API edge so the bad value
		// never even reaches the provider layer.
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "p1",
				name: "Mallory",
				email: "victim@example.com\r\nBcc: attacker@evil.com",
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("POST / returns 409 when email already exists for project (UNIQUE constraint)", async () => {
		// Critical: a duplicate email for the same project must surface as
		// 409, not 500. Otherwise the Add-Recipient UI shows a generic error
		// and the operator can't tell what went wrong. Triggered by SQLite's
		// UNIQUE constraint failure on (project_id, email).
		const dbThatThrowsUnique = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(null)),
					run: vi.fn(() =>
						Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: recipients.email")),
					),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(dbThatThrowsUnique);
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "proj_001",
				name: "Alice",
				email: "dup@example.com",
			}),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/already exists/i);
	});

	test("PUT /:id returns 404 when not found", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/rec_999", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Recipient not found");
	});

	test("PUT /:id updates recipient (full shape, not just updated field)", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleRecipient }));
		const res = await req("/rec_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.name).toBe("Updated");
		// Pin id + project_id + email — a regression returning {name:'Updated'}
		// alone would silently break the dashboard's recipient list.
		expect(body.id).toBe("rec_001");
		expect(body.project_id).toBeDefined();
		expect(body.email).toBeDefined();
	});

	test("PUT /:id returns 400 for invalid input", async () => {
		// Schema validation must reject malformed PUT bodies (e.g. wrong type)
		// before any DB write is attempted.
		const { req } = createApp(createMockDB({ firstResult: sampleRecipient }));
		const res = await req("/rec_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "not-an-email" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("PUT /:id returns 409 when changing email collides with existing", async () => {
		// Symmetric to POST 409: editing a recipient's email to one that
		// already exists for the same project must return 409, not crash.
		const dbThatThrowsUniqueOnUpdate = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(sampleRecipient)),
					run: vi.fn(() =>
						Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: recipients.email")),
					),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(dbThatThrowsUniqueOnUpdate);
		const res = await req("/rec_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "dup@example.com" }),
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/already exists/i);
	});

	test("POST / propagates non-UNIQUE DB errors (line 46 rethrow)", async () => {
		// POST catch narrowly handles UNIQUE→409. Generic DB errors must be
		// rethrown so Hono surfaces them as 500 with an audit trail; silently
		// returning 409 would mislead the operator into thinking the email
		// already exists when actually the disk is full / connection lost.
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const db = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(null)),
					run: vi.fn(() => Promise.reject(new Error("D1_ERROR: disk full"))),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: "proj_001",
				name: "Alice",
				email: "new@example.com",
			}),
		});
		expect(res.status).toBe(500);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	test("PUT /:id propagates non-UNIQUE DB errors (line 64 rethrow)", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const db = {
			prepare: vi.fn(() => ({
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
					first: vi.fn(() => Promise.resolve(sampleRecipient)),
					run: vi.fn(() => Promise.reject(new Error("D1_ERROR: timeout"))),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/rec_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(500);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	test("DELETE /:id returns 204 on success AND issues DELETE SQL with bound id (defense against silent-no-op regression)", async () => {
		const sqlSeen: string[] = [];
		const bindsSeen: unknown[][] = [];
		const { req } = createApp(createMockDB({ firstResult: sampleRecipient, sqlSeen, bindsSeen }));
		const res = await req("/rec_001", { method: "DELETE" });
		expect(res.status).toBe(204);
		const text = await res.text();
		expect(text).toBe("");
		// CRITICAL: pin that the DELETE SQL was actually issued. Pre-pin,
		// a regression that returned 204 WITHOUT calling deleteRecipient
		// (e.g. early-return for 'optimization', or auth-bypass refactor)
		// would silently leave records in the DB while clients believed
		// they were deleted — catastrophic for GDPR/data-deletion compliance.
		const deleteSqls = sqlSeen.filter((s) => /DELETE\s+FROM\s+recipients/i.test(s));
		expect(deleteSqls.length).toBeGreaterThanOrEqual(1);
		// The id MUST be bound (not e.g. all rows wiped via a missing WHERE).
		expect(deleteSqls[0]).toMatch(/WHERE\s+id\s*=\s*\?/i);
		// Bind position pin: id is the only param.
		const deleteBind = bindsSeen.find((b) => b[0] === "rec_001");
		expect(deleteBind).toBeDefined();
	});

	test("DELETE /:id returns 404 when not found", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/rec_999", { method: "DELETE" });
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Recipient not found");
	});
});
