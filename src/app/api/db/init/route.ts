import { NextResponse } from "next/server";
import { initializeSchema } from "@/lib/db/schema";

/**
 * POST /api/db/init — Initialize database schema.
 *
 * NOT a public route. Requires:
 * 1. Session auth (enforced by proxy.ts)
 * 2. NODE_ENV !== 'production' (hard gate below)
 *
 * In production, schema must be initialized via CLI or deployment script.
 */
export async function POST() {
  // Hard gate: never run in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Schema initialization is disabled in production" },
      { status: 403 },
    );
  }

  try {
    await initializeSchema();
    return NextResponse.json({ success: true, message: "Schema initialized" });
  } catch (error) {
    console.error("Failed to initialize schema:", error);
    return NextResponse.json(
      { error: "Failed to initialize schema", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
