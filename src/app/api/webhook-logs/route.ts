import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listWebhookLogs, listAllWebhookLogs } from "@/lib/db/webhook-logs";

/**
 * GET /api/webhook-logs?projectId=&limit=&offset=
 * List webhook logs, paginated.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const projectId = params.get("projectId");
    const limit = Number(params.get("limit") ?? "50");
    const offset = Number(params.get("offset") ?? "0");

    const logs = projectId
      ? await listWebhookLogs(projectId, { limit, offset })
      : await listAllWebhookLogs({ limit, offset });

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Failed to list webhook logs:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
