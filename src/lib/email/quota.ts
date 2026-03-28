/**
 * Quota checking — soft limits (best-effort).
 *
 * Each project has daily and monthly send limits. Under concurrent
 * requests, brief over-delivery is possible. The authoritative count
 * is always send_logs with status = 'sent' and sent_at in the window.
 */

import { countDailySends, countMonthlySends } from "@/lib/db/send-logs";
import type { Project } from "@/lib/db/projects";

export interface QuotaCheck {
  allowed: boolean;
  error_code?: "quota_daily_exceeded" | "quota_monthly_exceeded";
  daily: { used: number; limit: number };
  monthly: { used: number; limit: number };
}

/**
 * Check whether a project has remaining quota for sending.
 *
 * Returns { allowed: true } if both daily and monthly quotas have room.
 * Otherwise returns { allowed: false, error_code } with the first
 * exceeded limit.
 */
export async function checkQuota(project: Project): Promise<QuotaCheck> {
  const [dailyUsed, monthlyUsed] = await Promise.all([
    countDailySends(project.id),
    countMonthlySends(project.id),
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
