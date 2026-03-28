"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, FolderKanban, Mail, CalendarDays, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { SendsChart } from "@/components/charts/sends-chart";

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
    <div className="rounded-lg border border-border bg-background/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ?? "bg-primary/10"}`}>
          <Icon className={`h-4 w-4 ${accent ? "text-current" : "text-primary"}`} />
        </div>
      </div>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
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
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Email relay overview and send activity.
          </p>
        </div>

        {loading && !stats ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
