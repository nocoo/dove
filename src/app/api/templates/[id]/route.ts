import { NextResponse } from "next/server";
import { getTemplate, updateTemplate, deleteTemplate } from "@/lib/db/templates";
import { z } from "zod/v4";

const VariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
  default: z.string().optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Slug must be lowercase alphanumeric with hyphens/underscores").optional(),
  subject: z.string().min(1).max(500).optional(),
  body_markdown: z.string().min(1).optional(),
  variables: z.array(VariableSchema).optional(),
});

/**
 * GET /api/templates/[id] — Get template detail.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error) {
    console.error("Failed to get template:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/templates/[id] — Update a template.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = UpdateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await updateTemplate(id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "A template with this slug already exists in this project" },
        { status: 409 },
      );
    }
    console.error("Failed to update template:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/templates/[id] — Delete a template.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const deleted = await deleteTemplate(id);
    if (!deleted) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete template:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
