/**
 * Tests for server-side Template CRUD operations with native D1 binding.
 */
import { describe, expect, test, mock } from "bun:test";
import {
  listTemplates,
  listAllTemplates,
  getTemplate,
  getTemplateBySlug,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  parseVariables,
  type Template,
  type TemplateVariable,
} from "../lib/db/templates";

// Create a mock D1Result
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

// Sample template fixture
function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tmpl-test-id-12345",
    project_id: "proj-test-id-12345",
    name: "Welcome Email",
    slug: "welcome",
    subject: "Welcome to {{app_name}}!",
    body_markdown: "Hello {{name}},\n\nWelcome!",
    variables: JSON.stringify([
      { name: "name", type: "string", required: true },
      { name: "app_name", type: "string", required: true },
    ]),
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Mock D1Database
function createMockDb(options: {
  queryResults?: Template[];
  firstResult?: Template | null;
}) {
  const mockStmt = {
    all: mock(() => Promise.resolve({ results: options.queryResults ?? [] })),
    first: mock(() => Promise.resolve(options.firstResult ?? null)),
    run: mock(() => Promise.resolve(createMockResult())),
  };

  return {
    prepare: mock(() => ({
      bind: mock(() => mockStmt),
    })),
    _stmt: mockStmt,
  } as unknown as D1Database;
}

describe("Templates CRUD (native D1)", () => {
  describe("parseVariables", () => {
    test("parses valid JSON variables", () => {
      const template = makeTemplate();
      const vars = parseVariables(template);

      expect(vars).toHaveLength(2);
      expect(vars[0]!.name).toBe("name");
      expect(vars[0]!.type).toBe("string");
      expect(vars[0]!.required).toBe(true);
    });

    test("returns empty array for invalid JSON", () => {
      const template = makeTemplate({ variables: "invalid json" });
      const vars = parseVariables(template);

      expect(vars).toEqual([]);
    });

    test("returns empty array for empty JSON array", () => {
      const template = makeTemplate({ variables: "[]" });
      const vars = parseVariables(template);

      expect(vars).toEqual([]);
    });
  });

  describe("listTemplates", () => {
    test("returns all templates for a project", async () => {
      const templates = [
        makeTemplate({ id: "t1", slug: "welcome" }),
        makeTemplate({ id: "t2", slug: "reset-password" }),
      ];
      const mockDb = createMockDb({ queryResults: templates });

      const result = await listTemplates(mockDb, "proj-1");

      expect(result).toHaveLength(2);
      expect(result[0]!.slug).toBe("welcome");
    });

    test("returns empty array when no templates", async () => {
      const mockDb = createMockDb({ queryResults: [] });

      const result = await listTemplates(mockDb, "proj-1");

      expect(result).toEqual([]);
    });
  });

  describe("listAllTemplates", () => {
    test("returns all templates across projects", async () => {
      const templates = [
        makeTemplate({ id: "t1", project_id: "p1" }),
        makeTemplate({ id: "t2", project_id: "p2" }),
      ];
      const mockDb = createMockDb({ queryResults: templates });

      const result = await listAllTemplates(mockDb);

      expect(result).toHaveLength(2);
    });
  });

  describe("getTemplate", () => {
    test("returns template when found", async () => {
      const template = makeTemplate();
      const mockDb = createMockDb({ firstResult: template });

      const result = await getTemplate(mockDb, template.id);

      expect(result).not.toBeNull();
      expect(result?.slug).toBe("welcome");
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getTemplate(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getTemplateBySlug", () => {
    test("returns template when slug matches", async () => {
      const template = makeTemplate();
      const mockDb = createMockDb({ firstResult: template });

      const result = await getTemplateBySlug(
        mockDb,
        template.project_id,
        template.slug,
      );

      expect(result).not.toBeNull();
      expect(result?.slug).toBe(template.slug);
    });

    test("returns null when slug not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getTemplateBySlug(mockDb, "proj-1", "unknown-slug");

      expect(result).toBeNull();
    });
  });

  describe("createTemplate", () => {
    test("creates template with generated ID", async () => {
      const mockDb = createMockDb({});

      const result = await createTemplate(mockDb, {
        project_id: "proj-123",
        name: "New Template",
        slug: "new-template",
        subject: "Hello {{name}}",
        body_markdown: "Hi {{name}}!",
      });

      expect(result.id).toHaveLength(21);
      expect(result.name).toBe("New Template");
      expect(result.slug).toBe("new-template");
      expect(result.variables).toBe("[]");
    });

    test("creates template with variables", async () => {
      const mockDb = createMockDb({});
      const variables: TemplateVariable[] = [
        { name: "name", type: "string", required: true },
        { name: "age", type: "number", required: false, default: "18" },
      ];

      const result = await createTemplate(mockDb, {
        project_id: "proj-123",
        name: "With Vars",
        slug: "with-vars",
        subject: "Hello",
        body_markdown: "Body",
        variables,
      });

      const parsed = JSON.parse(result.variables) as TemplateVariable[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.name).toBe("name");
    });
  });

  describe("updateTemplate", () => {
    test("updates template fields", async () => {
      const existing = makeTemplate();
      let callCount = 0;
      const mockStmt = {
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const result = await updateTemplate(mockDb, existing.id, {
        name: "Updated Name",
        subject: "New Subject",
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Updated Name");
      expect(result?.subject).toBe("New Subject");
      expect(result?.slug).toBe(existing.slug);
    });

    test("updates variables array", async () => {
      const existing = makeTemplate();
      let callCount = 0;
      const mockStmt = {
        all: mock(() => Promise.resolve({ results: [] })),
        first: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: mock(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: mock(() => ({
          bind: mock(() => mockStmt),
        })),
      } as unknown as D1Database;

      const newVars: TemplateVariable[] = [
        { name: "new_var", type: "boolean", required: false },
      ];
      const result = await updateTemplate(mockDb, existing.id, {
        variables: newVars,
      });

      const parsed = JSON.parse(result!.variables) as TemplateVariable[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe("new_var");
    });

    test("returns null when template not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await updateTemplate(mockDb, "nonexistent", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteTemplate", () => {
    test("deletes existing template", async () => {
      const existing = makeTemplate();
      const mockDb = createMockDb({ firstResult: existing });

      const result = await deleteTemplate(mockDb, existing.id);

      expect(result).toBe(true);
    });

    test("returns false when template not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteTemplate(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });
});
