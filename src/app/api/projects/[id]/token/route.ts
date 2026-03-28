import { NextResponse } from "next/server";
import { regenerateToken } from "@/lib/db/projects";

/**
 * POST /api/projects/[id]/token — Regenerate webhook token.
 * Returns the new plaintext token exactly once.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = await regenerateToken(id);
    if (!token) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ webhook_token: token });
  } catch (error) {
    console.error("Failed to regenerate token:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
