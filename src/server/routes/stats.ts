import { Hono } from "hono";
import type { Env } from "../env";
import { query } from "../lib/db/d1";
import { listProjects } from "../lib/db/projects";
import { countDailySends, countMonthlySends } from "../lib/db/send-logs";

const stats = new Hono<{ Bindings: Env }>();

stats.get("/", async (c) => {
	const projects = await listProjects(c.env.DB);

	let totalSendsToday = 0;
	let totalSendsMonth = 0;

	for (const project of projects) {
		const [daily, monthly] = await Promise.all([
			countDailySends(c.env.DB, project.id),
			countMonthlySends(c.env.DB, project.id),
		]);
		totalSendsToday += daily;
		totalSendsMonth += monthly;
	}

	const failedRows = await query<{ count: number }>(
		c.env.DB,
		`SELECT COUNT(*) as count FROM send_logs
     WHERE status = 'failed'
     AND created_at >= date('now') || 'T00:00:00.000Z'
     AND created_at < date('now', '+1 day') || 'T00:00:00.000Z'`,
	);

	return c.json({
		total_projects: projects.length,
		total_sends_today: totalSendsToday,
		total_sends_month: totalSendsMonth,
		total_failed_today: failedRows[0]?.count ?? 0,
	});
});

stats.get("/charts", async (c) => {
	const sentRows = await query<{ date: string; count: number }>(
		c.env.DB,
		`SELECT date(sent_at) as date, COUNT(*) as count
     FROM send_logs
     WHERE status = 'sent' AND sent_at >= date('now', '-30 days') || 'T00:00:00.000Z'
     GROUP BY date(sent_at)
     ORDER BY date(sent_at) ASC`,
	);

	const failedRows = await query<{ date: string; count: number }>(
		c.env.DB,
		`SELECT date(created_at) as date, COUNT(*) as count
     FROM send_logs
     WHERE status = 'failed' AND created_at >= date('now', '-30 days') || 'T00:00:00.000Z'
     GROUP BY date(created_at)
     ORDER BY date(created_at) ASC`,
	);

	const sentMap = new Map(sentRows.map((r) => [r.date, r.count]));
	const failedMap = new Map(failedRows.map((r) => [r.date, r.count]));

	const chartData: { date: string; sent: number; failed: number }[] = [];
	const today = new Date();

	for (let i = 29; i >= 0; i--) {
		const d = new Date(today);
		d.setUTCDate(d.getUTCDate() - i);
		const dateStr = d.toISOString().split("T")[0] ?? "";
		chartData.push({
			date: dateStr,
			sent: sentMap.get(dateStr) ?? 0,
			failed: failedMap.get(dateStr) ?? 0,
		});
	}

	return c.json(chartData);
});

export { stats };
