import type { Project } from "../db/projects";
import { countDailySends, countMonthlySends } from "../db/send-logs";

export interface QuotaCheck {
	allowed: boolean;
	error_code?: "quota_daily_exceeded" | "quota_monthly_exceeded";
	daily: { used: number; limit: number };
	monthly: { used: number; limit: number };
}

export async function checkQuota(db: D1Database, project: Project): Promise<QuotaCheck> {
	const [dailyUsed, monthlyUsed] = await Promise.all([
		countDailySends(db, project.id),
		countMonthlySends(db, project.id),
	]);

	const daily = { used: dailyUsed, limit: project.quota_daily };
	const monthly = { used: monthlyUsed, limit: project.quota_monthly };

	if (dailyUsed >= project.quota_daily) {
		return { allowed: false, error_code: "quota_daily_exceeded", daily, monthly };
	}

	if (monthlyUsed >= project.quota_monthly) {
		return { allowed: false, error_code: "quota_monthly_exceeded", daily, monthly };
	}

	return { allowed: true, daily, monthly };
}
