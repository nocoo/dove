/**
 * Tests for server-side Project CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
import {
  listProjects,
  getProject,
  getProjectByToken,
  createProject,
  updateProject,
  deleteProject,
  regenerateToken,
  type Project,
} from "../lib/db/projects";

// Create a vi D1Result for testing
function createMockResult(overrides: { changes?: number } = {}): D1Result {
  return {
    success: true,
    meta: {
      duration: 1,
      changes: overrides.changes ?? 0,
      last_row_id: 0,
      rows_read: 0,
      rows_written: 0,
      size_after: 0,
      changed_db: false,
    },
    results: [],
  } as unknown as D1Result;
}

// Sample project fixture
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "test-project-id-12345",
    name: "Test Project",
    description: "A test project",
    email_prefix: "noreply",
    from_name: "Test App",
    webhook_token: "tok_sample_token_48_chars_long_for_webhook_auth",
    quota_daily: 100,
    quota_monthly: 1000,
    provider_id: null,
    allow_unknown_recipients: false,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mock D1Database with flexible query results
function createMockDb(options: {
  queryResults?: Project[];
  firstResult?: Project | null;
}) {
  const mockStmt = {
    all: vi.fn(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: vi.fn(() => Promise.resolve(options.firstResult ?? null)),
    run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
  };
  const bindFn = vi.fn(() => mockStmt);

  return {
    prepare: vi.fn(() => ({
      bind: bindFn,
    })),
    batch: vi.fn(() => Promise.resolve([createMockResult()])),
    _stmt: mockStmt,
    _bind: bindFn,
  } as unknown as D1Database & { _stmt: typeof mockStmt; _bind: typeof bindFn };
}

describe("Projects CRUD (native D1)", () => {
  describe("listProjects", () => {
    test("returns all projects from D1", async () => {
      const projects = [
        makeProject({ id: "proj-1", name: "Project 1" }),
        makeProject({ id: "proj-2", name: "Project 2" }),
      ];
      const mockDb = createMockDb({ queryResults: projects });

      const result = await listProjects(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Project 1");
      expect(result[1]!.name).toBe("Project 2");
    });

    test("returns empty array when no projects exist", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      const result = await listProjects(mockDb);

      expect(result).toEqual([]);
    });
  });

  describe("getProject", () => {
    test("returns project when found AND pins WHERE id=? bind (defends auth-bypass-by-SQL-swap)", async () => {
      const project = makeProject();
      const mockDb = createMockDb({ firstResult: project });

      const result = await getProject(mockDb, project.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(project.id);
      expect(result?.name).toBe("Test Project");
      // SECURITY: pin SQL filter + bind. getProject is the lookup used
      // by authBearer middleware (`getProject(db, projectId)` then
      // `constantTimeEqual(project.webhook_token, token)`). A regression
      // that changed the SQL to `WHERE webhook_token = ?` would create
      // an auth-bypass: caller supplies projectId=<token>, getProject
      // looks up by that id, but actually finds the project whose token
      // equals that string — then constantTimeEqual passes (token IS
      // the project's token). Pin the by-id SQL + bind position.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(project.id);
    });

    test("returns null when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getProject(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getProjectByToken", () => {
    test("returns project when token matches AND pins WHERE webhook_token bind (auth-critical)", async () => {
      const project = makeProject();
      const mockDb = createMockDb({ firstResult: project });

      const result = await getProjectByToken(mockDb, project.webhook_token);

      expect(result).not.toBeNull();
      expect(result?.webhook_token).toBe(project.webhook_token);
      // AUTH-CRITICAL: this lookup is the entire bearer-token authentication.
      // A regression that:
      //  (a) changes the SQL filter from `WHERE webhook_token = ?` to
      //      `WHERE id = ?` would let a webhook authenticate as the
      //      project whose UUID happens to equal the bearer token —
      //      48-char tokens are unlikely to collide, but a determined
      //      attacker who learns a project id could craft one;
      //  (b) binds a stale outer-scope variable instead of `token`
      //      would make every webhook auth as the same wrong project;
      //  (c) drops the WHERE clause entirely (returns first project)
      //      would let ANY bearer token auth as the first row.
      // Mock returns project regardless of input — a 'mock-returns-
      // regardless' false-positive (see #179). Pin SQL + bind.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+webhook_token\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(project.webhook_token);
    });

    test("returns null when token not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getProjectByToken(mockDb, "invalid-token");

      expect(result).toBeNull();
    });
  });

  describe("createProject", () => {
    test("creates project with generated ID and token", async () => {
      const mockDb = createMockDb({});

      const result = await createProject(mockDb, {
        name: "New Project",
        email_prefix: "hello",
        from_name: "My App",
      });

      expect(result.id).toHaveLength(21); // nanoid default
      expect(result.webhook_token).toHaveLength(48);
      expect(result.name).toBe("New Project");
      expect(result.email_prefix).toBe("hello");
      expect(result.from_name).toBe("My App");
      expect(result.quota_daily).toBe(100);
      expect(result.quota_monthly).toBe(1000);
      expect(result.provider_id).toBeNull();
      // Guard against silent no-INSERT (project + secret token would be lost).
      const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(sqlCalls.some((s) => /INSERT INTO projects/i.test(s))).toBe(true);
    });

    test("creates project with custom quotas (pin INSERT bind positions)", async () => {
      // Distinct values (500 ≠ 5000) so a regression that swapped
      // quota_daily ↔ quota_monthly bind positions is caught — result
      // object reflects the in-memory variables (always passes), so the
      // ONLY way to detect column swap is by inspecting the prepared
      // statement's bind args.
      const mockDb = createMockDb({}) as D1Database & {
        _bind: ReturnType<typeof vi.fn>;
      };

      const result = await createProject(mockDb, {
        name: "High Volume",
        email_prefix: "bulk",
        from_name: "Bulk Sender",
        quota_daily: 500,
        quota_monthly: 5000,
      });

      expect(result.quota_daily).toBe(500);
      expect(result.quota_monthly).toBe(5000);
      // Bind order from src/server/lib/db/projects.ts:
      //  [id, name, description, email_prefix, from_name, webhook_token,
      //   quota_daily, quota_monthly, provider_id, allow_unknown_recipients,
      //   created_at, updated_at]
      const binds = mockDb._bind.mock.calls[0] as unknown[];
      expect(binds[1]).toBe("High Volume");          // name
      expect(binds[3]).toBe("bulk");                 // email_prefix
      expect(binds[4]).toBe("Bulk Sender");           // from_name
      expect(binds[6]).toBe(500);                    // quota_daily (NOT 5000)
      expect(binds[7]).toBe(5000);                   // quota_monthly (NOT 500)
      // allow_unknown_recipients defaults to 0 on create — pin the bind
      // index so a regression that shifted the column (e.g. accidentally
      // dropped it from the INSERT, breaking schema-vs-bind alignment)
      // would surface here. The default-false also defends against a
      // regression that flipped the default to true (unauthenticated
      // recipient bypass for every NEW project — disastrous).
      expect(binds[9]).toBe(0);
    });

    test("creates project with allow_unknown_recipients=true (pin bind value)", async () => {
      // Pin the truthy branch of `allow_unknown_recipients ? 1 : 0` at the
      // INSERT bind. Without this, a regression that hardcoded the bind
      // to 0 would silently break per-project opt-in (ellie's flow would
      // hit recipient_not_found 404 for every verification email).
      const mockDb = createMockDb({}) as D1Database & {
        _bind: ReturnType<typeof vi.fn>;
      };

      const result = await createProject(mockDb, {
        name: "Ellie",
        email_prefix: "verify",
        from_name: "Ellie",
        allow_unknown_recipients: true,
      });

      expect(result.allow_unknown_recipients).toBe(true);
      const binds = mockDb._bind.mock.calls[0] as unknown[];
      expect(binds[9]).toBe(1);
    });

    test("creates project with provider_id", async () => {
      const mockDb = createMockDb({});

      const result = await createProject(mockDb, {
        name: "With Provider",
        email_prefix: "test",
        from_name: "Test",
        provider_id: "provider-123",
      });

      expect(result.provider_id).toBe("provider-123");
    });
  });

  describe("updateProject", () => {
    test("updates project fields", async () => {
      const existing = makeProject();
      // First call (getProject) returns existing, second call doesn't happen in mock
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const bindFn = vi.fn(() => mockStmt);
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: bindFn,
        })),
      } as unknown as D1Database;

      const result = await updateProject(mockDb, existing.id, {
        name: "Updated Name",
        quota_daily: 200,
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Updated Name");
      expect(result?.quota_daily).toBe(200);
      // Unchanged fields preserved
      expect(result?.email_prefix).toBe(existing.email_prefix);
      // Pin UPDATE bind positions: [name, description, email_prefix,
      //  from_name, quota_daily, quota_monthly, provider_id,
      //  allow_unknown_recipients, updated_at, id].
      // Critical swaps caught:
      //   - name↔email_prefix: project label and SMTP local-part swapped.
      //     New email goes from 'Updated Name@domain' (invalid local part).
      //   - quota_daily↔quota_monthly: 200/day cap silently becomes
      //     200/month — customer hits their cap in 1 day, not 1 month.
      //   - from_name↔provider_id: provider lookup uses display name,
      //     fails. Display name shows the provider UUID. Both broken.
      const updateBinds = bindFn.mock.calls[1] as unknown[];
      expect(updateBinds[0]).toBe("Updated Name");                  // name (NOT email_prefix)
      expect(updateBinds[1]).toBe(existing.description);            // description unchanged
      expect(updateBinds[2]).toBe(existing.email_prefix);            // email_prefix (NOT name)
      expect(updateBinds[3]).toBe(existing.from_name);               // from_name unchanged
      expect(updateBinds[4]).toBe(200);                              // quota_daily (NOT monthly)
      expect(updateBinds[5]).toBe(existing.quota_monthly);          // quota_monthly unchanged
      expect(updateBinds[6]).toBe(existing.provider_id);             // provider_id (NOT from_name)
      expect(updateBinds[7]).toBe(0);                                // allow_unknown_recipients (false → 0)
      expect(updateBinds[9]).toBe(existing.id);                       // WHERE id
    });

    test("returns null when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await updateProject(mockDb, "nonexistent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });

    test("can set provider_id to null (legacy mode)", async () => {
      const existing = makeProject({ provider_id: "some-provider" });
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateProject(mockDb, existing.id, {
        provider_id: null,
      });

      expect(result?.provider_id).toBeNull();
    });

    test("writes a new description (covers the data.description !== undefined branch)", async () => {
      const existing = makeProject({ description: "old" });
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          // First call returns the existing row; second returns the updated row.
          return Promise.resolve(
            callCount === 1 ? existing : { ...existing, description: "new desc" },
          );
        }),
        run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateProject(mockDb, existing.id, {
        description: "new desc",
      });

      expect(result?.description).toBe("new desc");
    });

    test("can CLEAR description by passing null (defends against ?? regression that breaks 'unset' UX)", async () => {
      // Production code uses `data.description !== undefined ? data.description : existing.description`.
      // A refactor swapping to `data.description ?? existing.description`
      // would silently IGNORE null inputs (since `null ?? existing` returns existing),
      // making it impossible for users to clear their project description
      // via the dashboard. The bug is invisible to typecheck (both signatures match)
      // and invisible to the existing 'set new desc' test (non-null path).
      const existing = makeProject({ description: "old desc" });
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const bindFn = vi.fn(() => mockStmt);
      const mockDb = {
        prepare: vi.fn(() => ({ bind: bindFn })),
      } as unknown as D1Database;

      const result = await updateProject(mockDb, existing.id, {
        description: null,
      });

      // Both the in-memory result AND the UPDATE bind position 1
      // (description column) MUST be null — a `??` regression would
      // leave both as 'old desc'.
      expect(result?.description).toBeNull();
      const updateBinds = bindFn.mock.calls[1] as unknown[]; // calls[0] is SELECT existing
      expect(updateBinds[1]).toBeNull();
    });
  });

  describe("deleteProject", () => {
    test("deletes existing project", async () => {
      const existing = makeProject();
      const mockDb = createMockDb({ firstResult: existing });

      const result = await deleteProject(mockDb, existing.id);

      expect(result).toBe(true);
      // Guard: returning true without issuing DELETE would orphan all
      // child recipients/templates/send_logs (FK CASCADE assumes the
      // project row actually goes away).
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
      const deleteIdx = sqlCalls.findIndex((s) => /DELETE FROM projects/i.test(s));
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      // Pin the WHERE id BIND value — a regression that bound the wrong
      // variable (e.g. a stale id from a different scope) or a hardcoded
      // string would silently delete the wrong row, or no row, while
      // still returning true. The existing-check via getProject
      // doesn't validate the SECOND bind goes to DELETE correctly.
      const bindMock = (prepareMock.mock.results[deleteIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(existing.id);
    });

    test("returns false when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteProject(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("regenerateToken", () => {
    test("generates new 48-char token", async () => {
      const existing = makeProject();
      const oldToken = existing.webhook_token;
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const bindFn = vi.fn(() => mockStmt);
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: bindFn,
        })),
      } as unknown as D1Database;

      const newToken = await regenerateToken(mockDb, existing.id);

      expect(newToken).not.toBeNull();
      expect(newToken).toHaveLength(48);
      expect(newToken).not.toBe(oldToken);
      // CRITICAL: verify the RETURNED token is the SAME one persisted.
      // Pre-strengthening, the test only checked the return value — a
      // regression that returned a fresh token but bound the OLD token
      // (or an empty string) to UPDATE would silently rotate clients
      // off the WRONG token, locking them out while the dashboard
      // displays the new one. UPDATE bind order: [webhook_token,
      // updated_at, id]. bindFn.mock.calls[1] is the UPDATE
      // (calls[0] is the SELECT existing).
      const updateBinds = bindFn.mock.calls[1] as unknown[];
      expect(updateBinds[0]).toBe(newToken);    // NEW token persisted
      expect(updateBinds[0]).not.toBe(oldToken); // explicitly NOT the old one
      expect(updateBinds[2]).toBe(existing.id);  // WHERE correct project
    });

    test("returns null when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await regenerateToken(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });
});
