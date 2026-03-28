import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listSendLogs, listAllSendLogs } from "@/lib/db/send-logs";

/**
 * GET /api/send-logs?projectId=&status=&limit=&offset=
 * List send logs, paginated.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const projectId = params.get("projectId");
    const status = params.get("status") ?? undefined;
    const limit = Number(params.get("limit") ?? "50");
    const offset = Number(params.get("offset") ?? "0");

    const logs = projectId
      ? await listSendLogs(projectId, { limit, offset, status })
      : await listAllSendLogs({ limit, offset, status });

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Failed to list send logs:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
