"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderKanban, Mail, CalendarDays, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { SendsChart } from "@/components/charts/sends-chart";
import { DashboardSkeleton } from "@/components/skeletons";

interface DashboardStats {
  total_projects: number;
  total_sends_today: number;
  total_sends_month: number;
  total_failed_today: number;
}

interface ChartPoint {
  date: string;
  sent: number;
  failed: number;
}

function StatsCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs md:text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl md:text-3xl font-semibold font-display text-foreground tracking-tight">{value}</p>
        </div>
        <div className={`rounded-md ${accent ?? "bg-card"} p-2`}>
          <Icon className={`h-5 w-5 ${accent ? "text-current" : "text-muted-foreground"}`} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, chartsRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/stats/charts"),
      ]);

      if (statsRes.ok) {
        setStats(await statsRes.json() as DashboardStats);
      }
      if (chartsRes.ok) {
        setChartData(await chartsRes.json() as ChartPoint[]);
      }
    } catch {
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <AppShell>
      <div className="space-y-4 md:space-y-6">
        <div>
          <h1 className="text-xl font-semibold font-display">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Email relay overview and send activity.
          </p>
        </div>

        {loading && !stats ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              <StatsCard
                label="Projects"
                value={String(stats?.total_projects ?? 0)}
                icon={FolderKanban}
              />
              <StatsCard
                label="Sent Today"
                value={String(stats?.total_sends_today ?? 0)}
                icon={Mail}
              />
              <StatsCard
                label="Sent This Month"
                value={String(stats?.total_sends_month ?? 0)}
                icon={CalendarDays}
              />
              <StatsCard
                label="Failed Today"
                value={String(stats?.total_failed_today ?? 0)}
                icon={AlertTriangle}
                accent="bg-destructive/10 text-destructive"
              />
            </div>

            {/* Chart */}
            <SendsChart data={chartData ?? []} />
          </>
        )}
      </div>
    </AppShell>
  );
}
