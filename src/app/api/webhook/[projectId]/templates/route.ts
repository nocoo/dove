import { NextResponse } from "next/server";
import { getProject } from "@/lib/db/projects";
import { listTemplates } from "@/lib/db/templates";

/**
 * GET /api/webhook/[projectId]/templates — List available templates.
 * Authenticated via Bearer token.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  // Extract Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { code: "auth_missing", message: "Missing Authorization header" } },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);
  const project = await getProject(projectId);

  if (!project || project.webhook_token !== token) {
    return NextResponse.json(
      { error: { code: "auth_invalid", message: "Invalid token or project not found" } },
      { status: 403 },
    );
  }

  const templates = await listTemplates(projectId);

  // Return only slug, name, and variable declarations (not full body)
  const result = templates.map((t) => ({
    slug: t.slug,
    name: t.name,
    subject: t.subject,
    variables: t.variables,
  }));

  return NextResponse.json(result);
}
