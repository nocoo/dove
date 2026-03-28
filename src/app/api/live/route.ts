import { NextResponse } from "next/server";
import { isD1Configured, executeD1Query } from "@/lib/db/d1-client";

/**
 * GET /api/live — Health check (D1 ping + version).
 * Public, no auth.
 */
export async function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

  if (!isD1Configured()) {
    return NextResponse.json(
      { status: "degraded", version, d1: false, error: "D1 not configured" },
      { status: 503 },
    );
  }

  try {
    await executeD1Query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      version,
      d1: true,
    });
  } catch (error) {
    console.error("Health check D1 ping failed:", error);
    return NextResponse.json(
      { status: "degraded", version, d1: false, error: "D1 ping failed" },
      { status: 503 },
    );
  }
}
