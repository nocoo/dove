import { NextResponse } from "next/server";
import { getProject } from "@/lib/db/projects";

/**
 * HEAD /api/webhook/[projectId] — Health check (verify token).
 */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  // Extract Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new NextResponse(null, { status: 401 });
  }

  const token = authHeader.slice(7);
  const project = await getProject(projectId);

  if (!project || project.webhook_token !== token) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, { status: 200 });
}
