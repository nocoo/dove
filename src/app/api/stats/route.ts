import { NextResponse } from "next/server";
import { listProjects } from "@/lib/db/projects";
import { countDailySends, countMonthlySends } from "@/lib/db/send-logs";
import { executeD1Query } from "@/lib/db/d1-client";

interface DashboardStats {
  total_projects: number;
  total_sends_today: number;
  total_sends_month: number;
  total_failed_today: number;
}

/**
 * GET /api/stats — Dashboard summary stats.
 */
export async function GET() {
  try {
    const projects = await listProjects();

    // Aggregate daily and monthly sends across all projects
    let totalSendsToday = 0;
    let totalSendsMonth = 0;

    for (const project of projects) {
      const [daily, monthly] = await Promise.all([
        countDailySends(project.id),
        countMonthlySends(project.id),
      ]);
      totalSendsToday += daily;
      totalSendsMonth += monthly;
    }

    // Count failed sends today
    const failedRows = await executeD1Query<{ count: number }>(
      `SELECT COUNT(*) as count FROM send_logs
       WHERE status = 'failed'
       AND created_at >= date('now') || 'T00:00:00.000Z'
       AND created_at < date('now', '+1 day') || 'T00:00:00.000Z'`,
    );

    const stats: DashboardStats = {
      total_projects: projects.length,
      total_sends_today: totalSendsToday,
      total_sends_month: totalSendsMonth,
      total_failed_today: failedRows[0]?.count ?? 0,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Failed to get stats:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
