/**
 * Template rendering engine.
 *
 * Pipeline: validate variables → substitute {{var}} → Markdown → HTML → wrap.
 * All variable values are HTML-escaped before substitution.
 */

import { marked } from "marked";
import type { TemplateVariable } from "@/lib/db/templates";

/** HTML escape a string to prevent XSS via template variables. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Validate and coerce variables against the template's schema.
 *
 * Type coercion rules (string-in, coerce-on-validate):
 * - "string": used as-is
 * - "number": must pass Number() without NaN
 * - "boolean": must be "true" or "false" (case-insensitive)
 *
 * Returns the coerced values as strings (ready for substitution).
 * Throws descriptive error on validation failure.
 */
export function validateVariables(
  schema: TemplateVariable[],
  provided: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const decl of schema) {
    const raw = provided[decl.name];

    if (raw === undefined || raw === "") {
      if (decl.required) {
        if (decl.default !== undefined) {
          result[decl.name] = decl.default;
          continue;
        }
        throw new Error(`Missing required variable: ${decl.name}`);
      }
      // Optional with no value — use default or empty string
      result[decl.name] = decl.default ?? "";
      continue;
    }

    // Type coercion
    switch (decl.type) {
      case "string":
        result[decl.name] = raw;
        break;
      case "number": {
        const num = Number(raw);
        if (Number.isNaN(num)) {
          throw new Error(`Variable "${decl.name}" must be a valid number, got "${raw}"`);
        }
        result[decl.name] = String(num);
        break;
      }
      case "boolean": {
        const lower = raw.toLowerCase();
        if (lower !== "true" && lower !== "false") {
          throw new Error(`Variable "${decl.name}" must be "true" or "false", got "${raw}"`);
        }
        result[decl.name] = lower;
        break;
      }
    }
  }

  return result;
}

/**
 * Substitute {{var}} placeholders in a template string.
 * Values are HTML-escaped before insertion.
 */
export function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) return `{{${name}}}`;
    return escapeHtml(value);
  });
}

/**
 * Convert Markdown to HTML using marked.
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  return marked.parse(markdown, { async: true });
}

/** Minimal responsive email HTML wrapper. */
function wrapHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background-color: #f5f5f5; }
  .container { max-width: 600px; margin: 0 auto; padding: 24px; background-color: #ffffff; }
  h1, h2, h3 { color: #1a1a1a; margin-top: 0; }
  a { color: #3b6fd0; }
  code { background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background-color: #f0f0f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 3px solid #d0d0d0; padding-left: 12px; margin-left: 0; color: #555; }
</style>
</head>
<body>
<div class="container">
${bodyHtml}
</div>
</body>
</html>`;
}

/**
 * Full rendering pipeline: validate → substitute → Markdown → HTML → wrap.
 *
 * Returns { subject, html } ready for Resend API.
 */
export async function renderTemplate(
  subjectTemplate: string,
  bodyMarkdown: string,
  schema: TemplateVariable[],
  providedVariables: Record<string, string | undefined>,
): Promise<{ subject: string; html: string }> {
  // 1. Validate and coerce
  const variables = validateVariables(schema, providedVariables);

  // 2. Substitute in subject (plain text, still escaped for safety)
  const subject = substituteVariables(subjectTemplate, variables);

  // 3. Substitute in body, then convert Markdown → HTML
  const substitutedBody = substituteVariables(bodyMarkdown, variables);
  const bodyHtml = await markdownToHtml(substitutedBody);

  // 4. Wrap in email HTML
  const html = wrapHtml(bodyHtml);

  return { subject, html };
}
