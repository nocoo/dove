import { NextResponse } from "next/server";
import { executeD1Query } from "@/lib/db/d1-client";

interface ChartPoint {
  date: string;
  sent: number;
  failed: number;
}

/**
 * GET /api/stats/charts — Chart data: sends over the last 30 days.
 */
export async function GET() {
  try {
    // Sent count per day (last 30 days, using sent_at)
    const sentRows = await executeD1Query<{ date: string; count: number }>(
      `SELECT date(sent_at) as date, COUNT(*) as count
       FROM send_logs
       WHERE status = 'sent' AND sent_at >= date('now', '-30 days') || 'T00:00:00.000Z'
       GROUP BY date(sent_at)
       ORDER BY date(sent_at) ASC`,
    );

    // Failed count per day (last 30 days, using created_at)
    const failedRows = await executeD1Query<{ date: string; count: number }>(
      `SELECT date(created_at) as date, COUNT(*) as count
       FROM send_logs
       WHERE status = 'failed' AND created_at >= date('now', '-30 days') || 'T00:00:00.000Z'
       GROUP BY date(created_at)
       ORDER BY date(created_at) ASC`,
    );

    // Build a map of the last 30 days
    const sentMap = new Map(sentRows.map((r) => [r.date, r.count]));
    const failedMap = new Map(failedRows.map((r) => [r.date, r.count]));

    const chartData: ChartPoint[] = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().split("T")[0]!;

      chartData.push({
        date: dateStr,
        sent: sentMap.get(dateStr) ?? 0,
        failed: failedMap.get(dateStr) ?? 0,
      });
    }

    return NextResponse.json(chartData);
  } catch (error) {
    console.error("Failed to get chart data:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
