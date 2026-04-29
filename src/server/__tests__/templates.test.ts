/**
 * Tests for server-side Template CRUD operations with native D1 binding.
 */
import { describe, expect, test, vi } from "vitest";
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
    test("returns template when found AND pins WHERE id=? + id-bind (defends SQL-swap regression)", async () => {
      const template = makeTemplate();
      const mockDb = createMockDb({ firstResult: template });

      const result = await getTemplate(mockDb, template.id);

      expect(result).not.toBeNull();
      expect(result?.slug).toBe("welcome");
      // Same SQL+bind defense as #288 (getProject) and #290 (getRecipient/
      // getEmailProvider). getTemplate is used by routes for read-by-id.
      // A regression that swapped to e.g. WHERE slug=? would let a slug
      // collision (or attacker probing) read the wrong template.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(template.id);
    });

    test("returns null when not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getTemplate(mockDb, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getTemplateBySlug", () => {
    test("returns template when slug matches AND pins WHERE project_id + slug binds", async () => {
      const template = makeTemplate();
      const mockDb = createMockDb({ firstResult: template });

      const result = await getTemplateBySlug(
        mockDb,
        template.project_id,
        template.slug,
      );

      expect(result).not.toBeNull();
      expect(result?.slug).toBe(template.slug);
      // CRITICAL cross-tenant defense: template slugs are per-project.
      // A regression dropping WHERE project_id would let a webhook
      // request for slug='welcome' grab ANOTHER tenant's 'welcome'
      // template — sending the wrong content to the wrong recipients.
      // Worst case: customer A's marketing template gets sent under
      // customer B's webhook, with B's recipients getting A's email.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sql = prepareMock.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/WHERE\s+project_id\s*=\s*\?/i);
      expect(sql).toMatch(/slug\s*=\s*\?/i);
      const bindMock = (prepareMock.mock.results[0]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(template.project_id); // project_id (NOT slug)
      expect(binds[1]).toBe(template.slug);        // slug (NOT project)
    });

    test("returns null when slug not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await getTemplateBySlug(mockDb, "proj-1", "unknown-slug");

      expect(result).toBeNull();
    });
  });

  describe("createTemplate", () => {
    test("creates template with generated ID and pins INSERT bind positions", async () => {
      const mockDb = createMockDb({}) as D1Database & { _bind: ReturnType<typeof vi.fn> };

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
      // Guard against silent no-INSERT (would lose the template).
      const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(sqlCalls.some((s) => /INSERT INTO templates/i.test(s))).toBe(true);
      // Bind order from src/server/lib/db/templates.ts:
      //  [id, project_id, name, slug, subject, body_markdown, variables,
      //   created_at, updated_at]
      // Distinct values across name/slug/subject/body_markdown so a
      // regression that swapped any pair of these textual columns
      // (e.g. name ↔ slug, subject ↔ body_markdown) is caught.
      // Without this, the in-memory result.* assertions ALWAYS pass and
      // the wrong column would silently land in DB — sending email with
      // the slug as subject is a real customer-visible incident class.
      const binds = mockDb._bind.mock.calls[0] as unknown[];
      expect(binds[1]).toBe("proj-123");              // project_id
      expect(binds[2]).toBe("New Template");          // name
      expect(binds[3]).toBe("new-template");          // slug
      expect(binds[4]).toBe("Hello {{name}}");        // subject
      expect(binds[5]).toBe("Hi {{name}}!");           // body_markdown
      expect(binds[6]).toBe("[]");                    // variables (default)
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

      const result = await updateTemplate(mockDb, existing.id, {
        name: "Updated Name",
        subject: "New Subject",
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Updated Name");
      expect(result?.subject).toBe("New Subject");
      expect(result?.slug).toBe(existing.slug);
      // Guard against in-memory-only update: assert UPDATE actually issued.
      const sqlCalls = (mockDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(sqlCalls.some((s) => /UPDATE templates/i.test(s))).toBe(true);
      // Pin UPDATE bind positions: [name, slug, subject, body_markdown,
      //  variables, updated_at, id]. The merge logic in updateTemplate
      // fills unchanged fields from `existing`. Critical swaps caught:
      //   - name↔slug: send-by-slug lookups would break, dashboard
      //     labels garbled.
      //   - subject↔body_markdown: emails go out with body in subject
      //     line and subject in body — customer-visible disaster.
      const updateBinds = bindFn.mock.calls[1] as unknown[];
      expect(updateBinds[0]).toBe("Updated Name");          // name (NOT slug)
      expect(updateBinds[1]).toBe(existing.slug);           // slug unchanged
      expect(updateBinds[2]).toBe("New Subject");           // subject (NOT body_markdown)
      expect(updateBinds[3]).toBe(existing.body_markdown);  // body unchanged
      expect(updateBinds[4]).toBe(existing.variables);      // variables unchanged
      expect(updateBinds[6]).toBe(existing.id);              // WHERE id
    });

    test("updates variables array", async () => {
      const existing = makeTemplate();
      let callCount = 0;
      const mockStmt = {
        all: vi.fn(() => Promise.resolve({ results: [] })),
        first: vi.fn(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? existing : null);
        }),
        run: vi.fn(() => Promise.resolve(createMockResult())),
      };
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => mockStmt),
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
      // Guard: returning true without issuing DELETE would leave stale
      // template rows; same data-integrity class as the recipient case.
      const prepareMock = (mockDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare;
      const sqlCalls = prepareMock.mock.calls.map((c) => c[0] as string);
      const deleteIdx = sqlCalls.findIndex((s) => /DELETE FROM templates/i.test(s));
      expect(deleteIdx).toBeGreaterThanOrEqual(0);
      // Pin the WHERE id bind on DELETE — wrong-variable regression
      // would silently target the wrong row (or none) while still
      // returning true.
      const bindMock = (prepareMock.mock.results[deleteIdx]?.value as { bind: ReturnType<typeof vi.fn> } | undefined)?.bind;
      const binds = bindMock?.mock.calls[0] as unknown[];
      expect(binds[0]).toBe(existing.id);
    });

    test("returns false when template not found", async () => {
      const mockDb = createMockDb({ firstResult: null });

      const result = await deleteTemplate(mockDb, "nonexistent");

      expect(result).toBe(false);
    });
  });
});
