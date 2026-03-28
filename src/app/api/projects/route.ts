import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/db/projects";
import { sanitizeProject } from "@/lib/sanitize";
import { z } from "zod/v4";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  email_prefix: z.string().min(1).max(64),
  from_name: z.string().min(1).max(128),
  quota_daily: z.number().int().min(1).optional(),
  quota_monthly: z.number().int().min(1).optional(),
});

/**
 * GET /api/projects — List all projects.
 */
export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json(projects.map(sanitizeProject));
  } catch (error) {
    console.error("Failed to list projects:", error);
    return NextResponse.json(
      { error: "Failed to list projects" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/projects — Create a new project.
 * Returns the full project including webhook_token (one-time exposure).
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = CreateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const project = await createProject(parsed.data);
    // Return full project including token on creation (one-time)
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 },
    );
  }
}
