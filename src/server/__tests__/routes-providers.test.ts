import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import { providers } from "../routes/providers";

const sampleProvider = {
	id: "prov_001",
	name: "Resend Prod",
	type: "resend",
	domain: "example.com",
	config: JSON.stringify({ api_key: "re_1234567890abcdef" }),
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
								firstCallIdx++;
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
	app.route("/", providers);
	return {
		req: (path: string, init?: RequestInit) =>
			app.request(path, init, { DB: db } as unknown as Env),
	};
}

describe("providers route handlers", () => {
	test("GET / returns sanitized list (raw api_key never appears in response)", async () => {
		const { req } = createApp(createMockDB({ allResults: [sampleProvider] }));
		const res = await req("/");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { config: { api_key: string } }[];
		expect(body).toHaveLength(1);
		expect(body[0]?.config.api_key).toContain("••••••");
		// Defense-in-depth: assert the raw key is NOT present anywhere in
		// the serialized response (covers regressions that returned both
		// sanitized AND raw, or sanitized one field but not another).
		expect(JSON.stringify(body)).not.toContain("re_1234567890abcdef");
	});

	test("POST / creates provider 201", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "New",
				type: "resend",
				domain: "mail.example.com",
				config: { api_key: "re_test123" },
			}),
		});
		expect(res.status).toBe(201);
		// Created body must be sanitized (api_key MASKED, never raw) — a
		// regression returning the raw key would leak credentials in API
		// responses + UI logs.
		const body = (await res.json()) as {
			id: string;
			name: string;
			type: string;
			domain: string;
			config: { api_key: string };
		};
		expect(body.name).toBe("New");
		expect(body.type).toBe("resend");
		expect(body.config.api_key).not.toBe("re_test123");
		// Defense-in-depth: raw key never appears in POST response.
		expect(JSON.stringify(body)).not.toContain("re_test123");
		// Pin id (nanoid len 21) + domain (so dashboards can show the
		// newly-created provider) — a regression returning a partial
		// shape would silently strand the UI.
		expect(body.id).toHaveLength(21);
		expect(body.domain).toBe("mail.example.com");
	});

	test("POST / returns 400 for invalid config", async () => {
		const { req } = createApp(createMockDB());
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Bad",
				type: "resend",
				domain: "mail.example.com",
				config: {},
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid provider config/i);
	});

	test("PUT /:id returns 400 when body is malformed (e.g. type wrong shape)", async () => {
		// The schema-validation 400 short-circuit (line 70) must reject
		// malformed PUT bodies before any DB lookup. Catches a regression
		// where a typo in the schema lets bad data through to the DB.
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "unsupported_type" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("POST / returns 400 for missing required fields", async () => {
		// Schema validation 400 short-circuit on POST (line 42) — same
		// class of bug, separate code path. Without this, malformed creates
		// would crash the DB layer with cryptic errors.
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "only-name" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid input/i);
	});

	test("PUT /:id with valid new config persists normalized stringified config", async () => {
		// Covers line 87 (the success branch of `config !== undefined`):
		// when the operator supplies a valid new config, the route MUST
		// re-stringify it (canonical normalisation) before the UPDATE —
		// a regression that passed the raw object would corrupt storage.
		let updateBoundParams: unknown[] | null = null;
		const db = {
			prepare: vi.fn((sql: string) => ({
				bind: vi.fn((...params: unknown[]) => {
					if (sql.startsWith("UPDATE")) updateBoundParams = params;
					return {
						all: vi.fn(() => Promise.resolve({ results: [] })),
						first: vi.fn(() => Promise.resolve(sampleProvider)),
						run: vi.fn(() => Promise.resolve({ success: true })),
					};
				}),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ config: { api_key: "re_NEWKEY1234567890" } }),
		});
		expect(res.status).toBe(200);
		// The bound params must include a stringified config that round-trips
		// to the new api_key (proving the normalize-then-stringify happened).
		expect(updateBoundParams).not.toBeNull();
		const stringifiedConfig = (updateBoundParams as unknown as unknown[]).find(
			(p): p is string => typeof p === "string" && p.startsWith("{"),
		);
		expect(stringifiedConfig).toBeDefined();
		expect(JSON.parse(stringifiedConfig as string)).toEqual({
			api_key: "re_NEWKEY1234567890",
		});
	});

	test("PUT /:id type-only change with compatible stored config persists re-normalized config", async () => {
		// Covers line 99 (the success branch of `type-only-change with
		// compatible stored config`): resend→cloudflare succeeds because
		// CloudflareConfigSchema is permissive, so the route must
		// re-normalize the existing config under the new schema and persist
		// it. A regression that skipped the re-normalization would leave
		// the row's config keyed for the old type — next send would explode.
		let updateBoundParams: unknown[] | null = null;
		const db = {
			prepare: vi.fn((sql: string) => ({
				bind: vi.fn((...params: unknown[]) => {
					if (sql.startsWith("UPDATE")) updateBoundParams = params;
					return {
						all: vi.fn(() => Promise.resolve({ results: [] })),
						first: vi.fn(() => Promise.resolve(sampleProvider)),
						run: vi.fn(() => Promise.resolve({ success: true })),
					};
				}),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "cloudflare" }),
		});
		expect(res.status).toBe(200);
		expect(updateBoundParams).not.toBeNull();
		const stringifiedConfig = (updateBoundParams as unknown as unknown[]).find(
			(p): p is string => typeof p === "string" && p.startsWith("{"),
		);
		expect(stringifiedConfig).toBeDefined();
		const parsed = JSON.parse(stringifiedConfig as string) as unknown;
		// typeof === 'object' is too loose: null, [], even arrays satisfy it.
		// CloudflareConfigSchema is empty-object so the re-normalized
		// config MUST be exactly {} — a regression that persisted null,
		// [], or the original {api_key: ...} object would silently pass
		// the typeof check while breaking the next send.
		expect(parsed).toEqual({});
		expect(parsed).not.toBeNull();
		expect(Array.isArray(parsed)).toBe(false);
	});

	test("GET /:id returns sanitized provider (api_key MASKED, not raw)", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { config: { api_key: string } };
		expect(body.config.api_key).toContain("••••••");
		// CRITICAL secret-leak defense: a regression returning the RAW
		// api_key (e.g. forgot to call sanitizeProvider, or returned the
		// unsanitized DB row) might still incidentally contain the bullet
		// chars somewhere if the mask is concatenated. Also assert the
		// raw key is NOT present anywhere in the response — catches a
		// regression that returned BOTH the mask AND the raw key (e.g.
		// sanitize(...) merged onto raw row).
		expect(body.config.api_key).not.toBe("re_1234567890abcdef");
		expect(JSON.stringify(body)).not.toContain("re_1234567890abcdef");
	});

	test("GET /:id returns 404", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/missing");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Provider not found");
	});

	test("PUT /:id updates provider", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Updated" }),
		});
		expect(res.status).toBe(200);
		// Must return the sanitized updated row — a regression returning the
		// request body or empty would mislead the dashboard's optimistic UI.
		const body = (await res.json()) as { name: string; config: { api_key?: string } };
		// Pin the actual updated value, not just .toBeDefined() — a regression
		// that returned the OLD existing row instead of the merged update
		// would silently pass the weaker assertion.
		expect(body.name).toBe("Updated");
		if (body.config?.api_key) expect(body.config.api_key).not.toBe("re_1234567890abcdef");
		// Defense-in-depth: raw key MUST NOT appear anywhere in PUT response.
		expect(JSON.stringify(body)).not.toContain("re_1234567890abcdef");
	});

	test("PUT /:id returns 404 when provider missing and config supplied", async () => {
		// The config/type branch loads existing provider first; if missing we
		// must 404 before issuing UPDATE so we don't fabricate rows.
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/prov_999", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ config: { api_key: "re_xxx" } }),
		});
		expect(res.status).toBe(404);
	});

	test("PUT /:id returns 400 when new config is invalid for effective type", async () => {
		// Critical: prevents silent data corruption (e.g. saving a malformed
		// api_key under a resend provider). Validator runs against the
		// EFFECTIVE type (existing or newly-supplied).
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ config: { wrong_field: "oops" } }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid provider config/i);
	});

	test("PUT /:id returns 404 when provider missing on a name-only update", async () => {
		// Covers providers.ts:108 — PUT body without config/type skips the
		// early existence check at line 76-78. The route then proceeds
		// straight to updateEmailProvider, which itself returns null when
		// the row is missing. Without the second 404 guard a stray
		// {success:true} from D1 (mocked or otherwise) would respond 200
		// with an undefined-shaped body, lying about a successful rename.
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/prov_missing", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Renamed" }),
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Provider not found");
	});

	test("PUT /:id with type === existing.type and no config skips re-normalization", async () => {
		// Covers providers.ts:88 false branch — the `else if (type !==
		// undefined && type !== existing.type)` short-circuits when the
		// submitted type matches the stored type. Without this short-circuit
		// a no-op type=resend on a resend provider would needlessly re-parse
		// the stored config (and 400 if the stored config is technically
		// valid-but-not-round-trippable). The PUT must return 200 with the
		// existing config preserved verbatim.
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "resend" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id: string; type: string };
		expect(body.id).toBe("prov_001");
		expect(body.type).toBe("resend");
	});

	test("PUT /:id returns 400 when changing type without compatible stored config", async () => {
		// Switching type from cloudflare → resend without supplying a new
		// config must reject — the stored cloudflare config has no api_key,
		// so reinterpreting it under the resend schema would fail validation.
		// Without this guard the saved provider would silently break on next
		// send (resend impl deref's api_key).
		const cfProvider = { ...sampleProvider, type: "cloudflare", config: JSON.stringify({}) };
		const { req } = createApp(createMockDB({ firstResult: cfProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "resend" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/incompatible/i);
	});

	test("PUT /:id returns 400 when changing type and stored config is malformed JSON", async () => {
		// Defensive: an externally-corrupted config row shouldn't cascade
		// into a 500 on type-only updates. Surface 400 with a hint.
		const corruptedProvider = { ...sampleProvider, config: "{not-json" };
		const { req } = createApp(createMockDB({ firstResult: corruptedProvider }));
		const res = await req("/prov_001", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "cloudflare" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/malformed/i);
	});

	test("DELETE /:id returns 204 when not in use AND issues DELETE SQL with bound id (silent-no-op defense)", async () => {
		const sqlSeen: string[] = [];
		const bindsSeen: unknown[][] = [];
		const { req } = createApp(
			createMockDB({ firstResult: { count: 0, ...sampleProvider }, sqlSeen, bindsSeen }),
		);
		const res = await req("/prov_001", { method: "DELETE" });
		expect(res.status).toBe(204);
		// 204 must have empty body (per HTTP spec).
		const text = await res.text();
		expect(text).toBe("");
		// Defends silent-no-op: a regression that returned 204 without
		// DELETE FROM email_providers would leave the provider in DB —
		// ESPECIALLY dangerous because clients believe it's gone but the
		// FK constraint would fail when next assigning to a project, AND
		// the api_key remains in DB longer than the operator expected.
		const deleteSqls = sqlSeen.filter((s) => /DELETE\s+FROM\s+email_providers/i.test(s));
		expect(deleteSqls.length).toBeGreaterThanOrEqual(1);
		expect(deleteSqls[0]).toMatch(/WHERE\s+id\s*=\s*\?/i);
		const deleteBind = bindsSeen.find((b) => b[0] === "prov_001");
		expect(deleteBind).toBeDefined();
	});

	test("DELETE /:id returns 409 with provider_in_use code when referenced", async () => {
		// Critical safety path: deleting a provider while projects still
		// reference it would orphan their provider_id FK and silently break
		// their next send. The route MUST surface this as 409 with a stable
		// error code so clients can prompt the operator to reassign first.
		const { req } = createApp(createMockDB({ firstResult: { count: 3 } }));
		const res = await req("/prov_001", { method: "DELETE" });
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("provider_in_use");
		// The message should mention the count so operators know the scope.
		expect(body.error.message).toContain("3");
	});

	test("DELETE /:id returns 404 when not in use AND provider missing (line 124)", async () => {
		// Pins providers.ts:124 — the !deleted return path. Sequenced firsts:
		// (1) countProjectsByProvider returns {count: 0} so we proceed past
		// the in-use guard; (2) deleteEmailProvider's getEmailProvider
		// returns null — the row doesn't exist — so deleteEmailProvider
		// returns false. Without this 404 guard, an operator deleting an
		// already-deleted ID would see 204 (silent success) and falsely
		// think they had a stray row removed.
		const { req } = createApp(createMockDB({ firstResults: [{ count: 0 }, null] }));
		const res = await req("/prov_missing", { method: "DELETE" });
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Provider not found");
	});

	test("GET /:id/health returns health status for resend", async () => {
		const { req } = createApp(createMockDB({ firstResult: sampleProvider }));
		const res = await req("/prov_001/health");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { healthy: boolean; configValid: boolean; reachable: null };
		expect(body.healthy).toBe(true);
		expect(body.configValid).toBe(true);
		expect(body.reachable).toBeNull();
	});

	test("GET /:id/health returns 404 for missing provider", async () => {
		const { req } = createApp(createMockDB({ firstResult: null }));
		const res = await req("/missing/health");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Provider not found");
	});

	test("GET /:id/health surfaces configValid=false when stored config fails to parse", async () => {
		// Critical observability: the dashboard health endpoint must catch a
		// corrupted/incompatible stored config (e.g. resend provider with no
		// api_key after a manual DB edit) and surface configValid=false +
		// configError, NOT 500. Otherwise operators have no signal that the
		// provider will fail on the next send.
		const corruptedResend = { ...sampleProvider, config: JSON.stringify({}) }; // resend needs api_key
		const { req } = createApp(createMockDB({ firstResult: corruptedResend }));
		const res = await req("/prov_001/health");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			configValid: boolean;
			configError: string | null;
			healthy: boolean;
		};
		expect(body.configValid).toBe(false);
		expect(body.configError).not.toBeNull();
		expect(body.healthy).toBe(false);
	});

	test("GET /:id/health surfaces L3 degraded when recent success rate < 50% over ≥5 sends", async () => {
		// Covers the previously-uncovered lastSendHealth + L3-degraded branch
		// (lines 138-156 of providers.ts). When the provider's recent send
		// history has total ≥ 5 AND successRate < 0.5, /health must report
		// healthy=false even when configValid=true — critical signal so
		// operators rotate keys / restart upstream BEFORE the dashboard
		// looks fine but customers are dropping mail.
		const db = {
			prepare: vi.fn((sql: string) => ({
				bind: vi.fn(() => ({
					all: vi.fn(() =>
						Promise.resolve({
							// getProviderSendStats SELECT status, COUNT(*) — 4 failed, 2 sent of 6
							results: sql.includes("send_logs")
								? [
										{ status: "sent", count: 2 },
										{ status: "failed", count: 4 },
									]
								: [],
						}),
					),
					first: vi.fn(() => Promise.resolve(sampleProvider)),
					run: vi.fn(() => Promise.resolve({ success: true })),
				})),
			})),
		} as unknown as D1Database;
		const { req } = createApp(db);
		const res = await req("/prov_001/health");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			healthy: boolean;
			configValid: boolean;
			lastSendHealth: { total: number; sent: number; failed: number; successRate: number } | null;
		};
		// Config parses fine (so configValid stays true) but recent send
		// health is degraded — healthy must reflect both signals.
		expect(body.configValid).toBe(true);
		expect(body.healthy).toBe(false);
		expect(body.lastSendHealth).not.toBeNull();
		expect(body.lastSendHealth?.total).toBe(6);
		expect(body.lastSendHealth?.sent).toBe(2);
		expect(body.lastSendHealth?.failed).toBe(4);
		expect(body.lastSendHealth?.successRate).toBeCloseTo(2 / 6, 5);
	});
});
