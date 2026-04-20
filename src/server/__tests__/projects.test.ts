/**
 * Tests for server-side Project CRUD operations with native D1 binding.
 */
import { describe, expect, test, mock } from "bun:test";
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

// Create a mock D1Result for testing
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
    all: mock(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: mock(() => Promise.resolve(options.firstResult ?? null)),
    run: mock(() => Promise.resolve(createMockResult({ changes: 1 }))),
  };

  return {
    prepare: mock(() => ({
      bind: mock(() => mockStmt),
    })),
    batch: mock(() => Promise.resolve([createMockResult()])),
    _stmt: mockStmt,
  } as unknown as D1Database & { _stmt: typeof mockStmt };
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
    test("returns project when found", async () => {
      const project = makeProject();
      const mockDb = createMockDb({ firstResult: project });

      const result = await getProject(mockDb, project.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(project.id);
      expect(result?.name).toBe("Test Project");
    });

    test("returns null when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getProject(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getProjectByToken", () => {
    test("returns project when token matches", async () => {
      const project = makeProject();
      const mockDb = createMockDb({ firstResult: project });

      const result = await getProjectByToken(mockDb, project.webhook_token);

      expect(result).not.toBeNull();
      expect(result?.webhook_token).toBe(project.webhook_token);
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
    });

    test("creates project with custom quotas", async () => {
      const mockDb = createMockDb({});

      const result = await createProject(mockDb, {
        name: "High Volume",
        email_prefix: "bulk",
        from_name: "Bulk Sender",
        quota_daily: 500,
        quota_monthly: 5000,
      });

      expect(result.quota_daily).toBe(500);
      expect(result.quota_monthly).toBe(5000);
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
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
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
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateProject(mockDb, existing.id, {
        provider_id: null,
      });

      expect(result?.provider_id).toBeNull();
    });
  });

  describe("deleteProject", () => {
    test("deletes existing project", async () => {
      const existing = makeProject();
      const mockDb = createMockDb({ firstResult: existing });

      const result = await deleteProject(mockDb, existing.id);

      expect(result).toBe(true);
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
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult({ changes: 1 }))),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const newToken = await regenerateToken(mockDb, existing.id);

      expect(newToken).not.toBeNull();
      expect(newToken).toHaveLength(48);
      expect(newToken).not.toBe(oldToken);
    });

    test("returns null when project not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await regenerateToken(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });
});
