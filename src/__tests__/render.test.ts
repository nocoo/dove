import { describe, expect, test } from "bun:test";
import {
  escapeHtml,
  validateVariables,
  substituteVariables,
  markdownToHtml,
  renderTemplate,
} from "@/lib/email/render";
import type { TemplateVariable } from "@/lib/db/templates";

describe("escapeHtml", () => {
  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
    );
  });

  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  test("leaves safe strings unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

describe("validateVariables", () => {
  const stringVar: TemplateVariable = { name: "name", type: "string", required: true };
  const numberVar: TemplateVariable = { name: "count", type: "number", required: true };
  const boolVar: TemplateVariable = { name: "active", type: "boolean", required: true };

  test("passes string variables through", () => {
    const result = validateVariables([stringVar], { name: "Alice" });
    expect(result.name).toBe("Alice");
  });

  test("coerces number variables", () => {
    const result = validateVariables([numberVar], { count: "42" });
    expect(result.count).toBe("42");
  });

  test("rejects invalid number", () => {
    expect(() => validateVariables([numberVar], { count: "abc" })).toThrow(
      'must be a valid number',
    );
  });

  test("coerces boolean variables", () => {
    const result = validateVariables([boolVar], { active: "TRUE" });
    expect(result.active).toBe("true");
  });

  test("rejects invalid boolean", () => {
    expect(() => validateVariables([boolVar], { active: "yes" })).toThrow(
      'must be "true" or "false"',
    );
  });

  test("throws for missing required variable", () => {
    expect(() => validateVariables([stringVar], {})).toThrow("Missing required variable");
  });

  test("uses default for required variable when provided", () => {
    const varWithDefault: TemplateVariable = { name: "name", type: "string", required: true, default: "World" };
    const result = validateVariables([varWithDefault], {});
    expect(result.name).toBe("World");
  });

  test("uses default for optional variable when not provided", () => {
    const optionalVar: TemplateVariable = { name: "greeting", type: "string", required: false, default: "Hi" };
    const result = validateVariables([optionalVar], {});
    expect(result.greeting).toBe("Hi");
  });

  test("uses empty string for optional variable with no default", () => {
    const optionalVar: TemplateVariable = { name: "greeting", type: "string", required: false };
    const result = validateVariables([optionalVar], {});
    expect(result.greeting).toBe("");
  });
});

describe("substituteVariables", () => {
  test("replaces {{var}} placeholders", () => {
    const result = substituteVariables("Hello, {{name}}!", { name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  test("escapes HTML in variable values", () => {
    const result = substituteVariables("{{msg}}", { msg: "<b>bold</b>" });
    expect(result).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("leaves unknown placeholders intact", () => {
    const result = substituteVariables("{{known}} {{unknown}}", { known: "yes" });
    expect(result).toBe("yes {{unknown}}");
  });

  test("handles multiple occurrences", () => {
    const result = substituteVariables("{{x}} and {{x}}", { x: "val" });
    expect(result).toBe("val and val");
  });
});

describe("markdownToHtml", () => {
  test("converts headings", async () => {
    const html = await markdownToHtml("# Hello");
    expect(html).toContain("<h1>");
    expect(html).toContain("Hello");
  });

  test("converts paragraphs", async () => {
    const html = await markdownToHtml("Hello world");
    expect(html).toContain("<p>");
  });

  test("converts bold text", async () => {
    const html = await markdownToHtml("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("converts links", async () => {
    const html = await markdownToHtml("[link](https://example.com)");
    expect(html).toContain('<a href="https://example.com">link</a>');
  });
});

describe("renderTemplate", () => {
  const schema: TemplateVariable[] = [
    { name: "name", type: "string", required: true },
  ];

  test("renders full pipeline: validate → substitute → markdown → html → wrap", async () => {
    const result = await renderTemplate(
      "Welcome, {{name}}!",
      "# Hello, {{name}}\n\nWelcome to our app.",
      schema,
      { name: "Alice" },
    );

    expect(result.subject).toBe("Welcome, Alice!");
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("Hello, Alice");
    expect(result.html).toContain("<h1>");
    expect(result.html).toContain("class=\"container\"");
  });

  test("escapes HTML in variables for XSS prevention", async () => {
    const result = await renderTemplate(
      "Hello {{name}}",
      "Content for {{name}}",
      schema,
      { name: '<script>alert("xss")</script>' },
    );

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  test("throws on missing required variable", async () => {
    await expect(
      renderTemplate("Hello", "Body", schema, {}),
    ).rejects.toThrow("Missing required variable");
  });
});
