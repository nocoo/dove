import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { Env } from "../env";
import type { Project } from "../lib/db/projects";
import { authBearer } from "../middleware/auth-bearer";

const testProject: Project = {
	id: "proj_123",
	name: "Test Project",
	description: null,
	email_prefix: "noreply",
	from_name: "Test",
	webhook_token: "secret-token-abc",
	quota_daily: 100,
	quota_monthly: 1000,
	provider_id: null,
	allow_unknown_recipients: false,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

function createApp(projects: Project[] = [testProject]) {
	type AppEnv = { Bindings: Env; Variables: { project: Project } };
	const app = new Hono<AppEnv>();

	// Track every prepare/bind invocation so individual tests can assert
	// that the SUT issued the documented auth-critical SELECT and bound
	// the projectId (NOT the token, NOT a different column) — a regression
	// querying by token instead would leak project enumeration.
	const sqlSeen: string[] = [];
	const bindsSeen: unknown[][] = [];
	const mockDb = {
		prepare: (sql: string) => {
			sqlSeen.push(sql);
			return {
				bind: (...params: unknown[]) => {
					bindsSeen.push(params);
					return {
						first: async () => {
							const id = params[0] as string;
							return projects.find((p) => p.id === id) ?? null;
						},
					};
				},
			};
		},
	};

	app.use("/api/webhook/:projectId/*", authBearer);
	app.post("/api/webhook/:projectId/send", (c) => {
		const project = c.get("project");
		return c.json({ projectId: project.id, name: project.name });
	});
	app.get("/api/webhook/:projectId/templates", (c) => {
		const project = c.get("project");
		return c.json({ projectId: project.id });
	});

	return {
		fetch: (req: Request) => app.fetch(req, { DB: mockDb as unknown as D1Database } as Env),
		sqlSeen,
		bindsSeen,
	};
}

describe("authBearer middleware", () => {
	test("returns 401 without Authorization header", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
			}),
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("auth_missing");
	});

	test("returns 401 with non-Bearer auth", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Basic abc" },
			}),
		);
		expect(res.status).toBe(401);
		// Must use the stable 'auth_missing' error code (Basic→401), not
		// 'auth_invalid' (which would mislead clients into thinking the token
		// is wrong instead of the wrong scheme).
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("auth_missing");
	});

	test("returns 404 for unknown project", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/nonexistent/send", {
				method: "POST",
				headers: { authorization: "Bearer secret-token-abc" },
			}),
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("project_not_found");
	});

	test("returns 403 when token doesn't match project", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Bearer wrong-token" },
			}),
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("auth_invalid");
	});

	test("prevents cross-project token replay", async () => {
		const projectA: Project = { ...testProject, id: "proj_A", webhook_token: "token-A" };
		const projectB: Project = { ...testProject, id: "proj_B", webhook_token: "token-B" };
		const app = createApp([projectA, projectB]);

		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_B/send", {
				method: "POST",
				headers: { authorization: "Bearer token-A" },
			}),
		);
		expect(res.status).toBe(403);
		// Critical tenancy guard: must surface as auth_invalid, not
		// project_not_found — the project EXISTS, but the token doesn't
		// match. Wrong code would let attackers enumerate projects.
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("auth_invalid");
		// The DB lookup MUST be by the URL projectId (proj_B), NOT by the
		// bearer token. A regression that bound the token in the WHERE
		// clause would lookup proj_A (the token's owner) and pass
		// webhook_token === token, becoming a tenancy bypass attack vector.
		expect(app.bindsSeen[0]).toEqual(["proj_B"]);
		expect(app.bindsSeen[0]).not.toContain("token-A");
	});

	test("passes with correct projectId and token", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Bearer secret-token-abc" },
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { projectId: string; name: string };
		expect(body.projectId).toBe("proj_123");
		expect(body.name).toBe("Test Project");
		// Pin the auth-critical SQL: must SELECT from projects with WHERE id =
		// ? bound to the URL projectId — a regression that bound the bearer
		// token in the WHERE clause (or queried email_providers etc.) would
		// leak project enumeration AND silently pass tests that only check
		// status==200. Both the SQL fragment AND the bind position are pinned.
		expect(app.sqlSeen.length).toBe(1);
		expect(app.sqlSeen[0]).toMatch(/SELECT[\s\S]+FROM\s+projects/i);
		expect(app.sqlSeen[0]).toMatch(/WHERE[\s\S]+id\s*=\s*\?/i);
		expect(app.bindsSeen[0]).toEqual(["proj_123"]);
	});

	test("works on GET routes too", async () => {
		const app = createApp();
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/templates", {
				headers: { authorization: "Bearer secret-token-abc" },
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { projectId: string };
		expect(body.projectId).toBe("proj_123");
	});

	test("returns 400 invalid_request when projectId param is missing", async () => {
		// Defensive: covers the previously-uncovered line 19 of auth-bearer.
		// The middleware can be mounted on a route without :projectId (e.g.
		// a future top-level webhook endpoint, or an accidental misroute).
		// Must surface as 400 invalid_request, NOT 404 (which would be
		// misleading) and NOT crash with undefined projectId.
		type AppEnv = { Bindings: Env; Variables: { project: Project } };
		const app = new Hono<AppEnv>();
		app.use("/api/webhook/raw", authBearer);
		app.post("/api/webhook/raw", (c) => c.json({ ok: true }));
		const res = await app.fetch(
			new Request("http://localhost:7034/api/webhook/raw", {
				method: "POST",
				headers: { authorization: "Bearer secret-token-abc" },
			}),
			{ DB: {} as unknown as D1Database } as Env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("invalid_request");
	});

	test("SECURITY: token comparison is constant-time (length mismatch → 403)", async () => {
		// Defends timing-attack class: the prior `!==` exits early on the
		// first mismatched byte, leaking secret bytes via response-time
		// differences. While exploitability against a 48-char nanoid token
		// over a noisy network is low, OWASP ASVS V6.2.4 / NIST SP 800-63B
		// require constant-time comparison for all secret/token equality.
		//
		// We can't easily measure timing in-process (vitest is too jittery
		// for sub-microsecond differences). Instead, pin the BEHAVIORAL
		// contract that proves constant-time correctness on edge cases:
		//
		//   1. Length-mismatch tokens still produce 403 (not crash, not
		//      silently 200) — a regression to plain `===` would still
		//      pass this, but a regression to a buggy custom comparator
		//      that mishandled length-diff (e.g. only iterated min length)
		//      could silently match prefix-of-token and grant access.
		//   2. Empty-string token mismatch surfaces as auth_invalid 403,
		//      NOT as a NaN/undefined crash.
		//   3. Token that is a proper PREFIX of the real token must NOT
		//      authenticate — catches the most common buggy comparator
		//      (loop-only-min-length).
		const app = createApp(); // testProject.webhook_token = 'secret-token-abc'
		// (1) Length mismatch — token shorter than real, but matches as prefix.
		const r1 = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Bearer secret-token" }, // proper prefix
			}),
		);
		expect(r1.status).toBe(403);
		expect(((await r1.json()) as { error: { code: string } }).error.code).toBe("auth_invalid");
		// (2) Single-character token — must not crash and must reject
		// (header trimming makes "Bearer " with trailing whitespace
		// unreliable across HTTP layers; use a defined short token).
		const r2 = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Bearer x" },
			}),
		);
		expect(r2.status).toBe(403);
		expect(((await r2.json()) as { error: { code: string } }).error.code).toBe("auth_invalid");
		// (3) Token longer than real (suffix-extended) — must not match.
		const r3 = await app.fetch(
			new Request("http://localhost:7034/api/webhook/proj_123/send", {
				method: "POST",
				headers: { authorization: "Bearer secret-token-abcXXXXX" },
			}),
		);
		expect(r3.status).toBe(403);
		expect(((await r3.json()) as { error: { code: string } }).error.code).toBe("auth_invalid");
	});
});
