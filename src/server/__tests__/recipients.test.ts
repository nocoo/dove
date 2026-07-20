/**
 * Tests for server-side Recipient CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
import {
	createRecipient,
	deleteRecipient,
	getRecipient,
	getRecipientByEmail,
	listRecipients,
	normalizeEmail,
	type Recipient,
	updateRecipient,
} from "../lib/db/recipients";

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

// Sample recipient fixture
function makeRecipient(overrides: Partial<Recipient> = {}): Recipient {
	return {
		id: "recip-test-id-12345",
		project_id: "proj-test-id-12345",
		name: "John Doe",
		email: "john@example.com",
		created_at: "2025-01-01T00:00:00.000Z",
		...overrides,
	};
}

// Mock D1Database
function createMockDb(options: { queryResults?: Recipient[]; firstResult?: Recipient | null }) {
	const mockStmt = {
		all: vi.fn(() => Promise.resolve({ results: options.queryResults ?? [] })),
		first: vi.fn(() => Promise.resolve(options.firstResult ?? null)),
		run: vi.fn(() => Promise.resolve(createMockResult())),
	};
	const bindFn = vi.fn(() => mockStmt);

	return {
		prepare: vi.fn(() => ({
			bind: bindFn,
		})),
		_stmt: mockStmt,
		_bind: bindFn,
	} as unknown as D1Database & { _bind: typeof bindFn };
}

describe("Recipients CRUD (native D1)", () => {
	describe("normalizeEmail", () => {
		test("trims and lowercases email", () => {
			expect(normalizeEmail("  John@Example.COM  ")).toBe("john@example.com");
		});

		test("handles already normalized email", () => {
			expect(normalizeEmail("test@example.com")).toBe("test@example.com");
		});
	});

	describe("listRecipients", () => {
		test("returns all recipients for a project", async () => {
			const recipients = [
				makeRecipient({ id: "r1", name: "Alice" }),
				makeRecipient({ id: "r2", name: "Bob" }),
			];
			const mockDb = createMockDb({ queryResults: recipients });

			const result = await listRecipients(mockDb, "proj-1");

			expect(result).toHaveLength(2);
			expect(result[0]?.name).toBe("Alice");
		});

		test("returns empty array when no recipients", async () => {
			const mockDb = createMockDb({ queryResults: [] });

			const result = await listRecipients(mockDb, "proj-1");

			expect(result).toEqual([]);
		});
	});

	describe("getRecipient", () => {
		test("returns recipient when found AND pins WHERE id=? + id-bind (defends auth-critical SQL swap)", async () => {
			const recipient = makeRecipient();
			const mockDb = createMockDb({ firstResult: recipient });

			const result = await getRecipient(mockDb, recipient.id);

			expect(result).not.toBeNull();
			expect(result?.name).toBe("John Doe");
			// SECURITY: getRecipient is used by webhook /send to resolve
			// recipient-by-ID (when `to` has no @ sign). A regression that
			// changed the SQL filter from `WHERE id = ?` to e.g.
			// `WHERE email = ?` would return the wrong row — if the caller
			// supplied a recipient ID that happened to match another
			// recipient's email, send would go to the wrong person AND the
			// tenancy guard `recipient.project_id !== projectId` would fire
			// against the wrong row's project_id, possibly breaking it. Pin
			// SQL + bind position to defend.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sql = prepareMock.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe(recipient.id);
		});

		test("returns null when not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await getRecipient(mockDb, "nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("getRecipientByEmail", () => {
		test("returns recipient when email matches AND pins WHERE project_id + email", async () => {
			const recipient = makeRecipient();
			const mockDb = createMockDb({ firstResult: recipient });

			const result = await getRecipientByEmail(mockDb, recipient.project_id, recipient.email);

			expect(result).not.toBeNull();
			expect(result?.email).toBe(recipient.email);
			// Cross-tenant defense: recipient lookups MUST scope by project.
			// A regression dropping WHERE project_id would let a webhook
			// checking 'is user@example.com on the whitelist?' grab a match
			// from ANY tenant — bypassing the per-project recipient whitelist
			// and enabling unauthorized sends to arbitrary addresses.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sql = prepareMock.mock.calls[0]?.[0] as string;
			expect(sql).toMatch(/WHERE\s+project_id\s*=\s*\?/i);
			expect(sql).toMatch(/email\s*=\s*\?/i);
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe(recipient.project_id);
			expect(binds[1]).toBe(recipient.email);
		});

		test("normalizes email before lookup (verifies actual bind, not just pass-through)", async () => {
			const recipient = makeRecipient({ email: "john@example.com" });
			const mockDb = createMockDb({ firstResult: recipient });

			const result = await getRecipientByEmail(
				mockDb,
				recipient.project_id,
				"  JOHN@EXAMPLE.COM  ",
			);

			expect(result).not.toBeNull();
			// Pre-strengthening, this only checked result — but the mock
			// returns the recipient REGARDLESS of input, so a regression that
			// skipped normalizeEmail (binding raw '  JOHN@EXAMPLE.COM  ')
			// would silently pass. The actual bug class: in production the
			// un-normalized lookup would NEVER match a normalized stored
			// email, breaking the entire recipient-whitelist feature for
			// anyone whose email had whitespace or uppercase chars.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const bindMock = (
				prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[1]).toBe("john@example.com"); // normalized, NOT raw
		});

		test("returns null when email not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await getRecipientByEmail(mockDb, "proj-1", "unknown@example.com");

			expect(result).toBeNull();
		});
	});

	describe("createRecipient", () => {
		test("creates recipient with generated ID and pins INSERT bind positions", async () => {
			const mockDb = createMockDb({}) as D1Database & { _bind: ReturnType<typeof vi.fn> };

			const result = await createRecipient(mockDb, {
				project_id: "proj-123",
				name: "Jane Smith",
				email: "jane@example.com",
			});

			expect(result.id).toHaveLength(21);
			expect(result.name).toBe("Jane Smith");
			expect(result.email).toBe("jane@example.com");
			expect(result.project_id).toBe("proj-123");
			// Guard: a regression returning the synthesized object without
			// INSERTing it would silently lose data.
			const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
				(c) => c[0] as string,
			);
			expect(sqlCalls.some((s) => /INSERT INTO recipients/i.test(s))).toBe(true);
			// Bind order from src/server/lib/db/recipients.ts:
			//  [id, project_id, name, email, created_at]
			// The name↔email column-swap is the killer regression here —
			// a swap would put 'jane@example.com' in the name column and
			// 'Jane Smith' in the email column, so the UNIQUE(project_id,
			// email) constraint would dedupe by NAME instead of EMAIL,
			// causing duplicate-email recipients and breaking the
			// recipient whitelist semantics. result.* assertions cannot
			// catch this — they reflect input variables.
			const binds = mockDb._bind.mock.calls[0] as unknown[];
			expect(binds[1]).toBe("proj-123"); // project_id
			expect(binds[2]).toBe("Jane Smith"); // name
			expect(binds[3]).toBe("jane@example.com"); // email (NOT name)
		});

		test("normalizes email on create (verifies INSERT bind, not just return value)", async () => {
			const mockDb = createMockDb({}) as D1Database & { _bind: ReturnType<typeof vi.fn> };

			const result = await createRecipient(mockDb, {
				project_id: "proj-123",
				name: "Test",
				email: "  TEST@EXAMPLE.COM  ",
			});

			expect(result.email).toBe("test@example.com");
			// ALSO verify the normalized email is what gets PERSISTED — a
			// regression that returned the normalized email but bound the
			// RAW email to INSERT (e.g. accidentally using `data.email`
			// instead of the local `email` variable) would store
			// '  TEST@EXAMPLE.COM  ' in DB, breaking the UNIQUE(project_id,
			// email) constraint and the per-tenant whitelist lookup. The
			// bare result.email check would silently pass that bug.
			const insertBinds = mockDb._bind.mock.calls[0] as unknown[];
			expect(insertBinds[3]).toBe("test@example.com"); // bind position 3 = email
		});
	});

	describe("updateRecipient", () => {
		test("updates recipient fields", async () => {
			const existing = makeRecipient();
			let callCount = 0;
			const mockStmt = {
				all: vi.fn(() => Promise.resolve({ results: [] })),
				first: vi.fn(() => {
					callCount++;
					return Promise.resolve(callCount === 1 ? existing : null);
				}),
				run: vi.fn(() => Promise.resolve(createMockResult())),
			};
			const bindFn = vi.fn(() => mockStmt);
			const mockDb = {
				prepare: vi.fn(() => ({
					bind: bindFn,
				})),
			} as unknown as D1Database;

			const result = await updateRecipient(mockDb, existing.id, {
				name: "Updated Name",
			});

			expect(result).not.toBeNull();
			expect(result?.name).toBe("Updated Name");
			expect(result?.email).toBe(existing.email);
			// Guard: the returned object is built in-memory from the merge.
			// We must also verify an UPDATE was actually issued — otherwise a
			// regression that skips persistence would leave callers thinking
			// their edits stuck while the DB is unchanged.
			const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
				(c) => c[0] as string,
			);
			expect(sqlCalls.some((s) => /UPDATE recipients/i.test(s))).toBe(true);
			// Pin UPDATE bind positions: [name, email, id].
			// Find the UPDATE bind call (NOT the SELECT-existing one).
			// The first prepare call is the SELECT existing; the second is
			// the UPDATE. So bindFn.mock.calls[1] is the UPDATE bind.
			// A name↔email column swap on UPDATE would put 'Updated Name' in
			// the email column — in-memory result.* still passes (merged from
			// input + existing), but the DB would have garbage email.
			const updateBinds = bindFn.mock.calls[1] as unknown[];
			expect(updateBinds[0]).toBe("Updated Name"); // name (NOT email)
			expect(updateBinds[1]).toBe(existing.email); // email (NOT name)
			expect(updateBinds[2]).toBe(existing.id); // WHERE id
		});

		test("normalizes email on update (verifies UPDATE bind, not just return value)", async () => {
			const existing = makeRecipient();
			let callCount = 0;
			const mockStmt = {
				all: vi.fn(() => Promise.resolve({ results: [] })),
				first: vi.fn(() => {
					callCount++;
					return Promise.resolve(callCount === 1 ? existing : null);
				}),
				run: vi.fn(() => Promise.resolve(createMockResult())),
			};
			const bindFn = vi.fn(() => mockStmt);
			const mockDb = {
				prepare: vi.fn(() => ({
					bind: bindFn,
				})),
			} as unknown as D1Database;

			const result = await updateRecipient(mockDb, existing.id, {
				email: "  NEW@EXAMPLE.COM  ",
			});

			expect(result?.email).toBe("new@example.com");
			// ALSO verify normalized email lands in UPDATE bind position 1
			// (UPDATE recipients SET name=?, email=? WHERE id=?). Same
			// false-positive class as #180 but on the UPDATE path — a
			// regression normalizing only the returned object would silently
			// store '  NEW@EXAMPLE.COM  ' in DB, breaking subsequent
			// case-insensitive whitelist matches forever.
			// bindFn.mock.calls[1] is the UPDATE (calls[0] is SELECT existing).
			const updateBinds = bindFn.mock.calls[1] as unknown[];
			expect(updateBinds[1]).toBe("new@example.com"); // normalized, NOT raw
		});

		test("returns null when recipient not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await updateRecipient(mockDb, "nonexistent", {
				name: "New Name",
			});

			expect(result).toBeNull();
		});
	});

	describe("deleteRecipient", () => {
		test("deletes existing recipient", async () => {
			const existing = makeRecipient();
			const mockDb = createMockDb({ firstResult: existing });

			const result = await deleteRecipient(mockDb, existing.id);

			expect(result).toBe(true);
			// CRUCIAL: returning true without actually issuing DELETE would
			// leave stale recipients in the DB — a worst-case data integrity
			// bug. Verify the DELETE statement was prepared with the right id.
			const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
			const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
			const deleteIdx = sqlCalls.findIndex((s) => /DELETE FROM recipients/i.test(s));
			expect(deleteIdx).toBeGreaterThanOrEqual(0);
			// Pin the WHERE id bind — a regression that bound the wrong
			// variable would still return true (no checks/affected-rows here).
			const bindMock = (
				prepareMock.mock.results[deleteIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined
			)?.bind;
			const binds = bindMock?.mock.calls[0] as unknown[];
			expect(binds[0]).toBe(existing.id);
		});

		test("returns false when recipient not found", async () => {
			const mockDb = createMockDb({ firstResult: null });

			const result = await deleteRecipient(mockDb, "nonexistent");

			expect(result).toBe(false);
		});
	});
});
