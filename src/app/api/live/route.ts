import { NextResponse } from "next/server";
import { isD1Configured, executeD1Query } from "@/lib/db/d1-client";
import { APP_VERSION } from "@/lib/version";

/**
 * GET /api/live — Surety-standard health check.
 * Public, no auth.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const uptime = Math.floor(process.uptime());

  const base = {
    version: APP_VERSION,
    component: "dove",
    timestamp,
    uptime,
  };

  if (!isD1Configured()) {
    return NextResponse.json(
      {
        status: "error",
        ...base,
        database: { connected: false, error: "D1 not configured" },
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    await executeD1Query("SELECT 1 AS probe");
    return NextResponse.json(
      {
        status: "ok",
        ...base,
        database: { connected: true },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "D1 ping failed";
    const sanitized = raw.replace(/\bok\b/gi, "***");
    console.error("Health check D1 ping failed:", error);
    return NextResponse.json(
      {
        status: "error",
        ...base,
        database: { connected: false, error: sanitized },
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
