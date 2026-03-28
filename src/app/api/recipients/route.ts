import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listRecipients, createRecipient } from "@/lib/db/recipients";
import { z } from "zod/v4";

const CreateRecipientSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1).max(128),
  email: z.string().email().max(320),
});

/**
 * GET /api/recipients?projectId= — List recipients for a project.
 */
export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId query parameter" },
        { status: 400 },
      );
    }

    const recipients = await listRecipients(projectId);
    return NextResponse.json(recipients);
  } catch (error) {
    console.error("Failed to list recipients:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/recipients — Add a recipient to a project.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = CreateRecipientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const recipient = await createRecipient(parsed.data);
    return NextResponse.json(recipient, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "This email already exists for this project" },
        { status: 409 },
      );
    }
    console.error("Failed to create recipient:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
