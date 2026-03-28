import { NextResponse } from "next/server";
import { getProject, updateProject, deleteProject } from "@/lib/db/projects";
import { sanitizeProject } from "@/lib/sanitize";
import { z } from "zod/v4";

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  email_prefix: z.string().min(1).max(64).optional(),
  from_name: z.string().min(1).max(128).optional(),
  quota_daily: z.number().int().min(1).optional(),
  quota_monthly: z.number().int().min(1).optional(),
});

/**
 * GET /api/projects/[id] — Get project detail.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(sanitizeProject(project));
  } catch (error) {
    console.error("Failed to get project:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id] — Update project.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = UpdateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await updateProject(id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(sanitizeProject(updated));
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id] — Delete project (cascades).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const deleted = await deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
