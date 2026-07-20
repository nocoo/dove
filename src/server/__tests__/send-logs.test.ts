/**
 * Tests for server-side SendLog CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
import {
	countDailySends,
	countMonthlySends,
	createSendLog,
	findByIdempotencyKey,
	getProviderSendStats,
	getSendLog,
	listAllSendLogs,
	listSendLogs,
	markSendLogFailed,
	markSendLogSent,
	resetSendLogForRetry,
	type SendLog,
	updateSendLogProvider,
} from "../lib/db/send-logs";

// Create a vi D1Result
function createMockResult(): D1Result {
	return {
		success: true,
		meta: {
			duration: 1,
			changes: 1,
			last_row_id: 0,
			rows_read: 0,
			rows_written: 0,
			size_after: 0,
			changed_db: false,
		},
		results: [],
	} as unknown as D1Result;
}

// Sample send log fixture
function makeSendLog(overrides: Partial<SendLog> = {}): SendLog {
	return {
		id: "log-test-id-12345",
		project_id: "proj-test-id-12345",
		idempotency_key: "idem-key-123",
		payload_hash: "abc123hash",
		template_id: "tmpl-123",
		recipient_id: "recip-123",
		to_email: "user@example.com",
		subject: "Test Subject",
		status: "sending",
		resend_id: null,
		provider_id: null,
		provider_type: null,
		provider_message_id: null,
		error_message: null,
		created_at: "2025-01-01T00:00:00.000Z",
		sent_at: null,
		...overrides,
	};
}

// Mock D1Database
function createMockDb(options: {
	queryResults?: SendLog[];
	firstResult?: SendLog | { count: number } | null;
}) {
	const mockStmt = {
		all: vi.fn(() => Promise.resolve({ results: options.queryResults ?? [] })),
		first: vi.fn(() => Promise.resolve(options.firstResult ?? null)),
		run: vi.fn(() => Promise.resolve(createMockResult())),
	};

	return {
		prepare: vi.fn(() => ({
			bind: vi.fn(() => mockStmt),
		})),
		_stmt: mockStmt,
	} as unknown as D1Database;
}

describe("SendLogs CRUD (native D1)", () => {
	describe("listSendLogs", () => {
		test("returns send logs for a project", async () => {
			const logs = [makeSendLog({ id: "l1" }), makeSendLog({ id: "l2" })];
			const mockDb = createMockDb({ queryResults: logs });

			const result = await listSendLogs(mockDb, "proj-1");

			expect(result).toHaveLength(2);
		});

		test("filters by status when provided (pin bind positions for the status branch)", async () => {
			const mockDb = createMockDb({ queryResults: [] });

			await listSendLogs(mockDb, "proj-1", { status: "sent", limit: 33, offset: 7 });

			// Status filter MUST hit the dedicated SQL branch with `AND status = ?`
			// — otherwise the option silently falls through and callers get the
			// unfiltered result set (data exposure / wrong dashboard counts).
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const stmt = prepareMock.mock.calls
				.map((c) => c[0] as string)
				.find((s) => /SELECT[\s\S]+FROM send_logs/i.test(s));
			expect(stmt).toMatch(/AND\s+status\s*=\s*\?/i);
			// Pin bind positions: [projectId, status, limit, offset].
			// Distinct values across all 4 — a projectId↔status swap would
			// search by status='proj-1' (returns nothing); a limit↔offset
			// swap would silently return wrong page. toContain('sent') alone
			// doesn't catch any of these.
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("proj-1");
			expect(binds[1]).toBe("sent");
			expect(binds[2]).toBe(33); // LIMIT
			expect(binds[3]).toBe(7); // OFFSET
		});

		test("applies pagination (pin LIMIT/OFFSET bind positions, not just presence)", async () => {
			const mockDb = createMockDb({ queryResults: [] });

			await listSendLogs(mockDb, "proj-1", { limit: 10, offset: 20 });

			// limit + offset must actually flow through to the bound params,
			// not be silently swallowed (would return wrong page).
			// Original test used toContain(10) + toContain(20) — a limit↔offset
			// swap (limit=20, offset=10) would PASS both checks. Pin positions.
			// SQL: 'WHERE project_id = ? ORDER BY ... LIMIT ? OFFSET ?'
			// Binds: [projectId, limit, offset].
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("proj-1"); // project_id
			expect(binds[1]).toBe(10); // LIMIT (NOT offset)
			expect(binds[2]).toBe(20); // OFFSET (NOT limit)
		});
	});

	describe("listAllSendLogs", () => {
		test("returns logs across all projects", async () => {
			const logs = [makeSendLog({ project_id: "p1" }), makeSendLog({ project_id: "p2" })];
			const mockDb = createMockDb({ queryResults: logs });

			const result = await listAllSendLogs(mockDb);

			expect(result).toHaveLength(2);
		});

		test("filters by status when provided (pin all 3 bind positions)", async () => {
			const mockDb = createMockDb({ queryResults: [] });

			await listAllSendLogs(mockDb, { status: "failed", limit: 17, offset: 41 });

			// Same status-branch contract as listSendLogs.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const stmt = prepareMock.mock.calls
				.map((c) => c[0] as string)
				.find((s) => /SELECT[\s\S]+FROM send_logs/i.test(s));
			expect(stmt).toMatch(/WHERE\s+status\s*=\s*\?/i);
			// Binds: [status, limit, offset]. Distinct values — a status↔limit
			// swap or limit↔offset swap is otherwise invisible (toContain
			// 'failed' alone passes regardless of position).
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("failed");
			expect(binds[1]).toBe(17); // LIMIT
			expect(binds[2]).toBe(41); // OFFSET
		});
	});

	describe("getSendLog", () => {
		test("returns send log when found", async () => {
			const log = makeSendLog();
			const mockDb = createMockDb({ firstResult: log });

			const result = await getSendLog(mockDb, log.id);

			expect(result).not.toBeNull();
			expect(result?.to_email).toBe("user@example.com");
		});

		test("returns null when not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await getSendLog(mockDb, "nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("findByIdempotencyKey", () => {
		test("returns log when idempotency key matches AND pins WHERE project_id + key binds", async () => {
			const log = makeSendLog({ idempotency_key: "unique-key" });
			const mockDb = createMockDb({ firstResult: log });

			const result = await findByIdempotencyKey(mockDb, log.project_id, "unique-key");

			expect(result).not.toBeNull();
			expect(result?.idempotency_key).toBe("unique-key");
			// CRITICAL cross-tenant defense: idempotency keys are per-project.
			// A regression dropping WHERE project_id would let an idempotency
			// key collision across tenants return another tenant's send_log
			// — leaking send metadata AND breaking dedup semantics (one
			// customer's send could mark another customer's send as 'already
			// sent', dropping the actual delivery).
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sql = prepareMock.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+project_id\s*=\s*\?/i);
			expect(sql).toMatch(/idempotency_key\s*=\s*\?/i);
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			// Distinct values: project_id MUST come first (matches SQL order).
			// A swap would silently search by 'unique-key' as project_id
			// (probably finds nothing, but if the key happens to BE a valid
			// project id, we'd cross tenants).
			expect(binds[0]).toBe(log.project_id); // project_id (NOT key)
			expect(binds[1]).toBe("unique-key"); // idempotency_key (NOT project)
		});

		test("returns null when idempotency key not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await findByIdempotencyKey(mockDb, "proj-1", "unknown");

			expect(result).toBeNull();
		});
	});

	describe("createSendLog", () => {
		test("creates send log with status sending", async () => {
			const mockDb = createMockDb({});

			const result = await createSendLog(mockDb, {
				project_id: "proj-123",
				template_id: "tmpl-123",
				recipient_id: "recip-123",
				to_email: "test@example.com",
				subject: "Hello",
			});

			expect(result.id).toHaveLength(21);
			expect(result.status).toBe("sending");
			expect(result.to_email).toBe("test@example.com");
			expect(result.sent_at).toBeNull();
		});

		test("creates send log with idempotency key (pin INSERT bind positions)", async () => {
			const mockDb = createMockDb({});

			const result = await createSendLog(mockDb, {
				project_id: "proj-123",
				idempotency_key: "my-idem-key",
				payload_hash: "hash123",
				template_id: "tmpl-aaa",
				recipient_id: "recip-bbb",
				to_email: "test@example.com",
				subject: "Hello",
			});

			expect(result.idempotency_key).toBe("my-idem-key");
			expect(result.payload_hash).toBe("hash123");
			// Bind order from src/server/lib/db/send-logs.ts:153 — 12 columns
			// is the highest swap-risk INSERT in the codebase. Critical pairs:
			//   - idempotency_key (2) ↔ payload_hash (3): swap would break
			//     idempotent-replay detection (key would never match again)
			//     AND let payload divergence go undetected.
			//   - template_id (4) ↔ recipient_id (5): swap would log sends
			//     against the wrong template/recipient — audit-trail garbled,
			//     dashboard charts mis-attributed.
			//   - to_email (6) ↔ subject (7): swap would log subject as the
			//     destination address (queryable by-email lookups break).
			// Distinct values across all 6 columns make any pair-swap
			// immediately visible — in-memory result.* assertions can't.
			const prepareMock = mockDb.prepare as unknown as ReturnType<typeof vi.fn>;
			const insertCallIdx = prepareMock.mock.calls.findIndex((c) =>
				/INSERT INTO send_logs/i.test(c[0] as string),
			);
			expect(insertCallIdx).toBeGreaterThanOrEqual(0);
			const bindMock = (
				prepareMock.mock.results[insertCallIdx]?.value as
					| { bind: ReturnType<typeof vi.fn> }
					| undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[1]).toBe("proj-123"); // project_id
			expect(binds[2]).toBe("my-idem-key"); // idempotency_key (NOT hash)
			expect(binds[3]).toBe("hash123"); // payload_hash (NOT key)
			expect(binds[4]).toBe("tmpl-aaa"); // template_id (NOT recipient)
			expect(binds[5]).toBe("recip-bbb"); // recipient_id (NOT template)
			expect(binds[6]).toBe("test@example.com"); // to_email (NOT subject)
			expect(binds[7]).toBe("Hello"); // subject (NOT email)
		});

		test("creates send log with provider info", async () => {
			const mockDb = createMockDb({});

			const result = await createSendLog(mockDb, {
				project_id: "proj-123",
				template_id: "tmpl-123",
				recipient_id: "recip-123",
				to_email: "test@example.com",
				subject: "Hello",
				provider_id: "prov-123",
				provider_type: "resend",
			});

			expect(result.provider_id).toBe("prov-123");
			expect(result.provider_type).toBe("resend");
		});
	});

	describe("updateSendLogProvider", () => {
		test("updates provider info (pin UPDATE bind positions)", async () => {
			const mockDb = createMockDb({});

			await updateSendLogProvider(mockDb, "log-123", {
				provider_id: "prov-456",
				provider_type: "cloudflare",
			});

			// Was a no-op assertion (`expect(true).toBe(true)`). Now verify
			// an UPDATE was issued AND that the new provider values were bound
			// — a regression that silently dropped the write would be caught.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
			expect(sqlCalls.some((s) => /UPDATE send_logs[\s\S]*provider_id/i.test(s))).toBe(true);
			// Pin UPDATE bind positions: [provider_id, provider_type, id].
			// provider_id↔provider_type swap is the killer here — a UUID
			// would land in the type enum column (queries break, dashboard
			// bucketing collapses) and the type string ('cloudflare') would
			// land in the FK column (joins to email_providers fail).
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("prov-456"); // provider_id (UUID)
			expect(binds[1]).toBe("cloudflare"); // provider_type (enum)
			expect(binds[2]).toBe("log-123"); // WHERE id
		});
	});

	describe("resetSendLogForRetry", () => {
		test("resets status to sending and clears error (pin UPDATE bind positions)", async () => {
			const mockDb = createMockDb({});

			await resetSendLogForRetry(mockDb, "log-123", {
				to_email: "new@example.com",
				subject: "Retry Subject",
			});

			// Critical for retry semantics: must reset status='sending' AND
			// null out the previous error_message, otherwise the retry log
			// still looks failed/dirty in the UI.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
			const stmt = sqlCalls.find((s) => /UPDATE send_logs/i.test(s));
			expect(stmt).toBeDefined();
			expect(stmt).toMatch(/status\s*=\s*'sending'/i);
			expect(stmt).toMatch(/error_message\s*=\s*NULL/i);
			// Pin bind positions: [to_email, subject, id].
			// to_email↔subject swap on retry would send the next attempt with
			// the SUBJECT as the destination address (delivery fails AND audit
			// log lies about who was supposed to receive the message). Since
			// distinct values are used for both, a swap is immediately visible.
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("new@example.com"); // to_email (NOT subject)
			expect(binds[1]).toBe("Retry Subject"); // subject (NOT email)
			expect(binds[2]).toBe("log-123"); // WHERE id
		});
	});

	describe("markSendLogSent", () => {
		test("marks as sent with resend provider (dual-writes resend_id + provider_message_id)", async () => {
			const mockDb = createMockDb({});

			await markSendLogSent(mockDb, "log-123", {
				providerMessageId: "msg-id-123",
				providerType: "resend",
			});

			// Resend branch MUST also populate the legacy resend_id column
			// so that pre-provider-layer dashboards keep working.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const stmt = prepareMock.mock.calls
				.map((c) => c[0] as string)
				.find((s) => /UPDATE send_logs/i.test(s));
			expect(stmt).toBeDefined();
			expect(stmt).toMatch(/status\s*=\s*'sent'/i);
			expect(stmt).toMatch(/resend_id\s*=/i);
			expect(stmt).toMatch(/provider_message_id\s*=/i);
			// Pin the dual-write bind values: BOTH resend_id (legacy) AND
			// provider_message_id MUST receive the same providerMessageId.
			// A regression that bound an empty string to one (e.g. a stale
			// local variable) would silently break either the legacy or the
			// new dashboard path. Bind order: [resend_id, provider_message_id,
			// sent_at, id].
			const updateIdx = prepareMock.mock.calls.findIndex((c) =>
				/UPDATE send_logs/i.test(c[0] as string),
			);
			const bindMock = (
				prepareMock.mock.results[updateIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("msg-id-123"); // resend_id (dual-write source)
			expect(binds[1]).toBe("msg-id-123"); // provider_message_id (must match resend_id)
			expect(binds[3]).toBe("log-123"); // WHERE id
		});

		test("marks as sent with cloudflare provider (no resend_id column)", async () => {
			const mockDb = createMockDb({});

			await markSendLogSent(mockDb, "log-123", {
				providerMessageId: "cf-msg-123",
				providerType: "cloudflare",
			});

			// Cloudflare branch must NOT touch resend_id (it would be
			// misleading provenance: the message did not come from Resend).
			// This test combined with the resend-branch test above provably
			// catches a regression that swaps the two SQL templates.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const stmt = prepareMock.mock.calls
				.map((c) => c[0] as string)
				.find((s) => /UPDATE send_logs/i.test(s));
			expect(stmt).toBeDefined();
			expect(stmt).toMatch(/status\s*=\s*'sent'/i);
			expect(stmt).toMatch(/provider_message_id\s*=/i);
			expect(stmt).not.toMatch(/resend_id/i);
			// Pin bind positions: [provider_message_id, sent_at, id].
			// Wrong-variable bind here would record a sent message under the
			// wrong send_log row, breaking webhook delivery confirmation.
			const updateIdx = prepareMock.mock.calls.findIndex((c) =>
				/UPDATE send_logs/i.test(c[0] as string),
			);
			const bindMock = (
				prepareMock.mock.results[updateIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("cf-msg-123"); // provider_message_id
			expect(binds[2]).toBe("log-123"); // WHERE id
		});
	});

	describe("markSendLogFailed", () => {
		test("marks as failed with error message", async () => {
			const mockDb = createMockDb({});

			await markSendLogFailed(mockDb, "log-123", "Connection timeout");

			// Must persist status='failed' AND surface the actual error
			// message (not a generic 'send failed' constant) so operators
			// have a debugging breadcrumb. Mirror of webhook 502 strengthening.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
			const stmt = sqlCalls.find((s) => /UPDATE send_logs/i.test(s));
			expect(stmt).toBeDefined();
			expect(stmt).toMatch(/status\s*=\s*'failed'/i);
			expect(stmt).toMatch(/error_message\s*=/i);
			// The actual error string must be one of the bound parameters.
			expect(bindMock?.mock.calls.flat()).toContain("Connection timeout");
			// Pin positions: [error_message, id]. error_message↔id swap would
			// overwrite the WRONG send_log row's error field with the id
			// string — nonsensical audit data and target row stays in
			// 'sending' forever (would never get a final status).
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("Connection timeout"); // error_message (NOT id)
			expect(binds[1]).toBe("log-123"); // WHERE id (NOT error)
		});
	});

	describe("countDailySends", () => {
		test("returns count of daily sends AND pins WHERE project_id + status filter", async () => {
			const mockDb = createMockDb({ firstResult: { count: 42 } });

			const result = await countDailySends(mockDb, "proj-123");

			expect(result).toBe(42);
			// CRITICAL cross-tenant defense: verify the SQL filters by
			// project_id AND status='sent'. A regression that:
			//  - forgot WHERE project_id: would count ALL projects' sends
			//    against THIS customer's daily quota (worst case: legitimate
			//    quota lock-out OR fail-open if dropped entirely)
			//  - used status='failed' instead: quota would track failures,
			//    not sends — customers'd be billed for delivery failures
			//  - bound the wrong variable: same cross-tenant class
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sql = prepareMock.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+project_id\s*=\s*\?/i);
			expect(sql).toMatch(/status\s*=\s*'sent'/i);
			// Symmetric mirror of the monthly test's `month` pin (below):
			// daily MUST use a day-boundary, not a month-boundary. A
			// copy-paste regression that pasted the monthly SQL into the
			// daily function would silently turn the daily quota into a
			// monthly quota, allowing (monthly_limit / daily_limit)x overage
			// per day with NO error_code surfaced. Pin date('now') token.
			expect(sql).toMatch(/date\s*\(\s*'now'/i);
			expect(sql).not.toMatch(/strftime\s*\(\s*'%Y-%m-01'/i);
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			expect(bindMock?.mock.calls[0]?.[0]).toBe("proj-123");
		});

		test("returns 0 when no sends", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await countDailySends(mockDb, "proj-123");

			expect(result).toBe(0);
		});
	});

	describe("countMonthlySends", () => {
		test("returns count of monthly sends AND pins WHERE project_id + status filter", async () => {
			const mockDb = createMockDb({ firstResult: { count: 150 } });

			const result = await countMonthlySends(mockDb, "proj-123");

			expect(result).toBe(150);
			// Same cross-tenant + status-filter defense as the daily case.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sql = prepareMock.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+project_id\s*=\s*\?/i);
			expect(sql).toMatch(/status\s*=\s*'sent'/i);
			// Monthly query MUST use a month-boundary computation, not the
			// day-boundary used by countDailySends — a copy-paste regression
			// that left the daily SQL in this function would silently make
			// the monthly quota equivalent to a 1-day quota.
			expect(sql).toMatch(/month/i);
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			expect(bindMock?.mock.calls[0]?.[0]).toBe("proj-123");
		});

		test("returns 0 when no sends", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await countMonthlySends(mockDb, "proj-123");

			expect(result).toBe(0);
		});
	});

	describe("getProviderSendStats", () => {
		// The grouped query returns one row per status; the function maps them
		// into { total, sent, failed }. Tests must exercise both branches
		// (sent & failed) plus an unknown status that should only contribute to total.
		function statsMockDb(rows: { status: string; count: number }[]): D1Database {
			return {
				prepare: vi.fn(() => ({
					bind: vi.fn(() => ({
						all: vi.fn(() => Promise.resolve({ results: rows })),
					})),
				})),
			} as unknown as D1Database;
		}

		test("aggregates sent and failed counts from grouped rows AND pins SQL filter + bind positions", async () => {
			// Distinct providerId + non-default limit so a swap or wrong-bind
			// would alter what we assert.
			const prepareSpy = vi.fn();
			const bindSpy = vi.fn(() => ({
				all: vi.fn(() =>
					Promise.resolve({
						results: [
							{ status: "sent", count: 7 },
							{ status: "failed", count: 3 },
						],
					}),
				),
			}));
			prepareSpy.mockImplementation(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;

			const stats = await getProviderSendStats(db, "prov_distinct", 99);
			expect(stats).toEqual({ total: 10, sent: 7, failed: 3 });

			// Cross-provider defense: dropping `WHERE provider_id = ?` from the
			// outer query would aggregate ALL providers' stats under each
			// provider — misleading dashboards + cross-tenant data leak
			// (one customer sees how many emails another customer sent).
			const sql = prepareSpy.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+provider_id\s*=\s*\?/i);
			expect(sql).toMatch(/LIMIT\s+\?/i);
			// Binds: [providerId (outer WHERE), providerId (inner subquery), limit].
			// A regression that moved `limit` to position 0 would silently
			// search by providerId='99' (no rows). A regression dropping the
			// inner subquery's providerId would also cross-tenant leak.
			const binds = bindSpy.mock.calls[0] as unknown[];
			expect(binds[0]).toBe("prov_distinct");
			expect(binds[1]).toBe("prov_distinct");
			expect(binds[2]).toBe(99);
		});

		test("counts unknown statuses (e.g. 'pending') toward total only", async () => {
			const db = statsMockDb([
				{ status: "sent", count: 5 },
				{ status: "pending", count: 2 },
			]);
			const stats = await getProviderSendStats(db, "prov_1");
			// Pending is not 'sent' or 'failed' — it must not bump those buckets,
			// but must still increment total to reflect the underlying row count.
			expect(stats).toEqual({ total: 7, sent: 5, failed: 0 });
		});

		test("returns zeroed stats when there are no rows", async () => {
			const stats = await getProviderSendStats(statsMockDb([]), "prov_1");
			expect(stats).toEqual({ total: 0, sent: 0, failed: 0 });
		});
	});
});
