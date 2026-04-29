/**
 * Template rendering engine.
 *
 * Pipeline: validate variables → substitute {{var}} → Markdown → HTML → wrap.
 * All variable values are HTML-escaped before substitution.
 */

import { marked } from "marked";
import { decodeHTML } from "entities";
import type { TemplateVariable } from "@/lib/types/template";

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
 *
 * Defense-in-depth: blocks dangerous URL schemes (javascript:, data:,
 * vbscript:) in <a href> attributes. Variables flow through user-
 * controlled `{{url}}` substitutions; without this guard, a payload
 * like `url=javascript:alert(1)` against a template `[click]({{url}})`
 * would render as `<a href="javascript:alert(1)">` and execute in any
 * MUA that renders HTML anchors without its own URL sanitizer.
 */
const DANGEROUS_URL_RE = /^\s*(?:javascript|data|vbscript)\s*:/i;
// Protocol-relative URLs (//evil.com) inherit the page's protocol on
// the web; in email contexts they're ambiguous (no base URL) and most
// legitimate emails use absolute URLs. They're also a common phishing
// pattern — the displayed link text often hides the //-bare hostname.
// Block them in <a href> to prevent unintended outbound navigation.
const PROTOCOL_RELATIVE_RE = /^\s*\/\//;
// Image src is more permissive: data: URLs are common for inline
// images in emails (logos, icons embedded base64). Only block scripts.
const DANGEROUS_IMG_RE = /^\s*(?:javascript|vbscript)\s*:/i;
const safeRenderer = new marked.Renderer();
const origLink = safeRenderer.link.bind(safeRenderer);
const origImage = safeRenderer.image.bind(safeRenderer);
safeRenderer.link = function ({ href, title, tokens }: { href: string; title?: string | null; tokens: unknown[] }) {
  if (typeof href === "string") {
    const decoded = decodeHTML(href);
    if (DANGEROUS_URL_RE.test(decoded) || PROTOCOL_RELATIVE_RE.test(decoded)) {
      return origLink({ href: "#", title: title ?? null, tokens } as Parameters<typeof origLink>[0]);
    }
  }
  return origLink({ href, title: title ?? null, tokens } as Parameters<typeof origLink>[0]);
};
safeRenderer.image = function ({ href, title, text }: { href: string; title?: string | null; text: string }) {
  if (typeof href === "string") {
    const decoded = decodeHTML(href);
    if (DANGEROUS_IMG_RE.test(decoded)) {
      return origImage({ href: "#", title: title ?? null, text } as Parameters<typeof origImage>[0]);
    }
  }
  return origImage({ href, title: title ?? null, text } as Parameters<typeof origImage>[0]);
};
export async function markdownToHtml(markdown: string): Promise<string> {
  return marked.parse(markdown, { async: true, renderer: safeRenderer });
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
  a { color: #c5607d; }
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
