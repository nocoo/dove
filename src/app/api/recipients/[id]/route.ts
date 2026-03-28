import { NextResponse } from "next/server";
import { updateRecipient, deleteRecipient } from "@/lib/db/recipients";
import { z } from "zod/v4";

const UpdateRecipientSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.string().email().max(320).optional(),
});

/**
 * PUT /api/recipients/[id] — Update a recipient.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = UpdateRecipientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await updateRecipient(id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "This email already exists for this project" },
        { status: 409 },
      );
    }
    console.error("Failed to update recipient:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/recipients/[id] — Remove a recipient.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const deleted = await deleteRecipient(id);
    if (!deleted) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete recipient:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
