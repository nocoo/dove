import { NextResponse } from "next/server";
import { isD1Configured, executeD1Query } from "@/lib/db/d1-client";
import { APP_VERSION } from "@/lib/version";

/**
 * GET /api/live — Health check (D1 ping + version).
 * Public, no auth.
 */
export async function GET() {
  if (!isD1Configured()) {
    return NextResponse.json(
      { status: "degraded", version: APP_VERSION, d1: false, error: "D1 not configured" },
      { status: 503 },
    );
  }

  try {
    await executeD1Query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      version: APP_VERSION,
      d1: true,
    });
  } catch (error) {
    console.error("Health check D1 ping failed:", error);
    return NextResponse.json(
      { status: "degraded", version: APP_VERSION, d1: false, error: "D1 ping failed" },
      { status: 503 },
    );
  }
}
