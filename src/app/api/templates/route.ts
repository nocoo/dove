import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listTemplates, listAllTemplates, createTemplate } from "@/lib/db/templates";
import { z } from "zod/v4";

const VariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
  default: z.string().optional(),
});

const CreateTemplateSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Slug must be lowercase alphanumeric with hyphens/underscores"),
  subject: z.string().min(1).max(500),
  body_markdown: z.string().min(1),
  variables: z.array(VariableSchema).optional(),
});

/**
 * GET /api/templates?projectId= — List templates.
 * If projectId is provided, list for that project. Otherwise list all.
 */
export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId");

    const templates = projectId
      ? await listTemplates(projectId)
      : await listAllTemplates();

    return NextResponse.json(templates);
  } catch (error) {
    console.error("Failed to list templates:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/templates — Create a new template.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = CreateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const template = await createTemplate(parsed.data);
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "A template with this slug already exists in this project" },
        { status: 409 },
      );
    }
    console.error("Failed to create template:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
