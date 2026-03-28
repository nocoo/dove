import { NextResponse } from "next/server";
import { getTemplate, parseVariables } from "@/lib/db/templates";
import { renderTemplate } from "@/lib/email/render";
import { z } from "zod/v4";

const PreviewSchema = z.object({
  variables: z.record(z.string(), z.string()).optional(),
});

/**
 * POST /api/templates/[id]/preview — Render template with sample variables.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const body: unknown = await request.json();
    const parsed = PreviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const schema = parseVariables(template);
    const variables = parsed.data.variables ?? {};

    const result = await renderTemplate(
      template.subject,
      template.body_markdown,
      schema,
      variables,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 422 },
      );
    }
    console.error("Failed to preview template:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
