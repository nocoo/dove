import { describe, expect, test } from "vitest";
import {
  escapeHtml,
  validateVariables,
  substituteVariables,
  markdownToHtml,
  renderTemplate,
} from "@/lib/email/render";
import type { TemplateVariable } from "@/lib/types/template";

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

  test("escapes ampersand BEFORE angle brackets (order pins, not just per-char)", () => {
    // Pins the documented `&` → `&amp;` first, THEN `<` → `&lt;` ordering.
    // A regression that swapped the chain order would convert `<a>` to
    // `&amp;lt;a&amp;gt;` (double-escape) since the later `&` pass would
    // re-escape the `&` introduced by `<`/`>`/`\"` replacements.
    expect(escapeHtml("<a>")).toBe("&lt;a&gt;");
    expect(escapeHtml('a&"<b>')).toBe("a&amp;&quot;&lt;b&gt;");
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

  test("empty string for required variable is treated as missing (not a value)", () => {
    // Pins the `raw === ""` short-circuit on render.ts:40. A regression
    // that dropped the `raw === ""` check would accept `{ name: "" }`
    // as a valid value, silently sending emails with `Hello, !` blanks
    // instead of failing fast for the operator to fix the payload.
    expect(() => validateVariables([stringVar], { name: "" })).toThrow(
      "Missing required variable: name",
    );
  });

  test("required-with-empty-string-default is honored (not coerced to throw)", () => {
    // Pins `decl.default !== undefined` (NOT truthy-check). A regression
    // to `if (decl.default)` would skip an explicit empty-string default
    // and throw, breaking templates that intentionally use `""` as a
    // sentinel default.
    const varWithEmptyDefault: TemplateVariable = { name: "name", type: "string", required: true, default: "" };
    const result = validateVariables([varWithEmptyDefault], {});
    expect(result.name).toBe("");
  });

  test("boolean coercion canonicalizes to lowercase regardless of input case", () => {
    // Already partially covered (TRUE) but pin both sides + mixed-case
    // to lock the canonicalization contract — downstream renderers can
    // rely on receiving exactly "true"/"false".
    expect(validateVariables([boolVar], { active: "FALSE" }).active).toBe("false");
    expect(validateVariables([boolVar], { active: "True" }).active).toBe("true");
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

  test("BLOCKS javascript: scheme in link href (defense-in-depth XSS)", async () => {
    // Threat: variable substitution lets `[click]({{url}})` render as
    // `<a href="javascript:alert(1)">` if the user supplies
    // `url=javascript:alert(1)`. escapeHtml does NOT escape `:` so the
    // payload reaches marked unchanged. Without this guard, ANY MUA
    // that renders HTML anchors without its own URL-scheme sanitizer
    // (legacy webmail, native mail clients on some platforms) would
    // execute the script when the recipient clicks the link.
    const html = await markdownToHtml("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  test("BLOCKS data: scheme in link href (data-URL XSS / phishing)", async () => {
    // data:text/html;base64,... lets attackers smuggle full HTML
    // documents (including <script>) into a link target.
    const html = await markdownToHtml("[x](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("data:");
    expect(html).toContain('href="#"');
  });

  test("BLOCKS vbscript: scheme in link href (legacy IE/Outlook XSS)", async () => {
    // vbscript: URIs still execute in some Outlook configurations.
    const html = await markdownToHtml("[x](vbscript:msgbox)");
    expect(html).not.toContain("vbscript:");
  });

  test("BLOCKS leading-whitespace + uppercase scheme bypass attempts", async () => {
    // Defense against case + whitespace bypasses: ` JavaScript:`,
    // `\tJAVASCRIPT:`, `Data:` should all be blocked. The regex uses
    // `\s*` prefix and `i` flag.
    const html1 = await markdownToHtml("[x]( JavaScript:alert(1))");
    expect(html1).not.toMatch(/javascript:/i);
    const html2 = await markdownToHtml("[x](DATA:text/html,xx)");
    expect(html2).not.toMatch(/data:/i);
  });

  test("BLOCKS HTML entity-encoded javascript: scheme bypass (&#x6a;avascript:)", async () => {
    // Critical defense: attackers can encode scheme letters as HTML
    // entities (&#x6a; = 'j', &#97; = 'a') to bypass regex detection.
    // The regex runs before HTML entity decoding, so `&#x6a;avascript:`
    // would pass the check but decode to `javascript:` in the browser.
    // Fix: decode entities before applying the dangerous-scheme regex.
    const hexEncoded = await markdownToHtml("[x](&#x6a;avascript:alert(1))");
    expect(hexEncoded).toContain('href="#"');
    expect(hexEncoded).not.toContain("javascript:");
    const decEncoded = await markdownToHtml("[x](&#106;avascript:alert(1))");
    expect(decEncoded).toContain('href="#"');
    const mixedCase = await markdownToHtml("[x](&#x4A;AVASCRIPT:alert(1))");
    expect(mixedCase).toContain('href="#"');
    // data: and vbscript: entity-encoded variants
    const dataEncoded = await markdownToHtml("[x](&#100;ata:text/html,x)");
    expect(dataEncoded).toContain('href="#"');
    const vbsEncoded = await markdownToHtml("[x](&#x76;bscript:msgbox)");
    expect(vbsEncoded).toContain('href="#"');
  });

  test("BLOCKS HTML entity-encoded protocol-relative URLs (&#x2f;&#x2f;evil.com)", async () => {
    // Protocol-relative bypass via entity-encoded slashes.
    const encoded = await markdownToHtml("[x](&#x2f;&#x2f;evil.com)");
    expect(encoded).toContain('href="#"');
  });

  test("BLOCKS HTML entity-encoded schemes in image src", async () => {
    // Image src also needs entity decoding before scheme check.
    const jsImg = await markdownToHtml("![x](&#x6a;avascript:alert(1))");
    expect(jsImg).toContain('src="#"');
    expect(jsImg).not.toContain("javascript:");
    const vbsImg = await markdownToHtml("![x](&#x76;bscript:msgbox)");
    expect(vbsImg).toContain('src="#"');
  });

  test("BLOCKS named HTML entity &colon; bypass (javascript&colon;)", async () => {
    // Named entities like &colon; decode to ':' in browser/MUA parsing.
    // Without full entity decoding, 'javascript&colon;alert(1)' bypasses
    // the regex check but executes as 'javascript:alert(1)'.
    const colonLink = await markdownToHtml("[x](javascript&colon;alert(1))");
    expect(colonLink).toContain('href="#"');
    expect(colonLink).not.toContain("javascript&colon;");
    const dataColon = await markdownToHtml("[x](data&colon;text/html,x)");
    expect(dataColon).toContain('href="#"');
    const vbsColon = await markdownToHtml("[x](vbscript&colon;msgbox)");
    expect(vbsColon).toContain('href="#"');
    // Image src with named entity
    const jsImgColon = await markdownToHtml("![x](javascript&colon;alert(1))");
    expect(jsImgColon).toContain('src="#"');
  });

  test("handles invalid numeric entity codepoints gracefully (no crash)", async () => {
    // Invalid codepoints (e.g. &#x110000; > U+10FFFF) should not cause
    // markdownToHtml to throw. The entities library handles these gracefully.
    const invalid = await markdownToHtml("[x](&#x110000;avascript:alert(1))");
    expect(invalid).toBeDefined();
    // Should still be a valid anchor (not crash)
    expect(invalid).toContain("<a");
  });

  test("PRESERVES safe schemes (https, mailto, relative paths)", async () => {
    // Pin: only the dangerous-scheme regex matches. A regression that
    // over-broadly stripped ALL hrefs (e.g. `if (href) href = '#'`)
    // would break every link in every email — silently — since
    // emails would still render with `href="#"` everywhere.
    expect(await markdownToHtml("[a](https://example.com)")).toContain(
      'href="https://example.com"',
    );
    expect(await markdownToHtml("[b](mailto:a@b.c)")).toContain(
      'href="mailto:a@b.c"',
    );
    expect(await markdownToHtml("[c](/relative/path)")).toContain(
      'href="/relative/path"',
    );
  });

  test("safeRenderer override does NOT break other markdown features (defense-in-breadth)", async () => {
    // The safeRenderer overrides `link` and `image` methods only. A
    // regression that accidentally also overrode/broke other renderer
    // methods (e.g. someone extending the override pattern and mis-
    // wiring `list`/`code`/`blockquote` to undefined) would silently
    // strip every list, code block, and blockquote from outbound emails
    // — they'd render as plain text. Pin all four core block features.
    const list = await markdownToHtml("- a\n- b");
    expect(list).toContain("<ul>");
    expect(list).toContain("<li>a</li>");
    const code = await markdownToHtml("```js\nconst x = 1;\n```");
    expect(code).toContain("<pre>");
    expect(code).toContain("<code");
    const table = await markdownToHtml("|a|b|\n|-|-|\n|1|2|");
    expect(table).toContain("<table>");
    expect(table).toContain("<th>a</th>");
    const quote = await markdownToHtml("> quoted");
    expect(quote).toContain("<blockquote>");
    expect(quote).toContain("quoted");
  });

  test("safeRenderer link/image overrides preserve title and alt attributes", async () => {
    // Specific defense for the security override: a regression that
    // dropped the title or alt parameters when forwarding to origLink/
    // origImage would silently strip those attributes from outbound
    // emails. title=tooltip is used for accessibility (screen readers),
    // alt is REQUIRED by WCAG for images. Pin both to defend the
    // override's argument-forwarding completeness.
    const linkTitle = await markdownToHtml('[a](https://example.com "tooltip")');
    expect(linkTitle).toContain('href="https://example.com"');
    expect(linkTitle).toContain('title="tooltip"');
    const imgTitle = await markdownToHtml('![alt](https://x.com/i.png "tooltip")');
    expect(imgTitle).toContain('src="https://x.com/i.png"');
    expect(imgTitle).toContain('alt="alt"');
    expect(imgTitle).toContain('title="tooltip"');
    // Sanitized link must STILL preserve title (defends regression that
    // re-stripped it on the security path).
    const sanLinkTitle = await markdownToHtml('[a](javascript:bad "tooltip")');
    expect(sanLinkTitle).toContain('href="#"');
    expect(sanLinkTitle).toContain('title="tooltip"');
  });

  test("BLOCKS protocol-relative URLs in <a href> (//evil.com phishing vector)", async () => {
    // Protocol-relative URLs inherit the page's protocol on the web,
    // but in email contexts they're ambiguous (no base URL). MUAs that
    // resolve them with a default https:// prefix would silently send
    // recipients to attacker domains. The display text often hides the
    // //-bare hostname, making this a common phishing pattern.
    expect(await markdownToHtml("[a](//evil.com)")).toContain('href="#"');
    expect(await markdownToHtml("[b](//evil.com/path)")).toContain('href="#"');
    // Whitespace-prefix bypass attempt also blocked.
    expect(await markdownToHtml("[c]( //evil.com)")).toContain('href="#"');
    // Single-slash absolute paths are NOT protocol-relative — must
    // pass through unchanged (legitimate email-relative or unsubscribe
    // links may use them).
    expect(await markdownToHtml("[d](/safe)")).toContain('href="/safe"');
  });

  test("BLOCKS javascript:/vbscript: in image src but PRESERVES data: (inline images)", async () => {
    // <img src=javascript:> is largely a non-issue in modern browsers
    // but legacy Outlook/MUAs may execute it. Block. Inline data:image/*
    // base64 is a legitimate email pattern (embedded logos, icons), so
    // ALLOW data: in img src — but never in <a href> (covered above).
    const jsImg = await markdownToHtml("![x](javascript:alert(1))");
    expect(jsImg).not.toMatch(/javascript:/i);
    const vbsImg = await markdownToHtml("![y](vbscript:msgbox)");
    expect(vbsImg).not.toMatch(/vbscript:/i);
    // Legitimate inline image — must pass through.
    const dataImg = await markdownToHtml("![z](data:image/png;base64,iVBORw0KG)");
    expect(dataImg).toContain('src="data:image/png;base64,iVBORw0KG"');
    // Normal external image must work.
    const httpsImg = await markdownToHtml("![w](https://cdn.example.com/i.png)");
    expect(httpsImg).toContain('src="https://cdn.example.com/i.png"');
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
    // ALSO pin: subject is escaped too. Without this, a regression that
    // skipped substitution-escape on the subject would inject raw HTML
    // into email subjects — some MUAs render basic HTML in subject
    // previews, which would leak the XSS payload to the recipient list.
    expect(result.subject).not.toContain("<script>");
    expect(result.subject).toContain("&lt;script&gt;");
  });

  test("throws on missing required variable", async () => {
    await expect(
      renderTemplate("Hello", "Body", schema, {}),
    ).rejects.toThrow("Missing required variable");
  });
});
