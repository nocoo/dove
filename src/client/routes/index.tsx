import { toast } from "@nocoo/basalt";
import { AlertTriangle, CalendarDays, FolderKanban, Mail } from "@nocoo/basalt/icons";
import { useCallback, useEffect, useState } from "react";
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
	index = 0,
}: {
	label: string;
	value: string;
	icon: React.ComponentType<{ className?: string | undefined }>;
	accent?: string | undefined;
	index?: number | undefined;
}) {
	return (
		<div
			className="rounded-basalt-lg bg-basalt-secondary p-4 md:p-5 ring-1 ring-basalt-border/80 shadow-basalt-card"
			style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
		>
			<div className="flex items-start justify-between">
				<div className="space-y-1">
					<p className="text-basalt-xs md:text-basalt-sm text-basalt-muted-foreground">{label}</p>
					<p className="text-basalt-3xl md:text-basalt-3xl font-semibold text-basalt-foreground tracking-tight tabular-nums">
						{value}
					</p>
				</div>
				<div className={`rounded-md ${accent ?? "bg-basalt-card"} p-2`}>
					<Icon className={`h-5 w-5 ${accent ? "text-current" : "text-basalt-muted-foreground"}`} />
				</div>
			</div>
		</div>
	);
}

export function Dashboard() {
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
				setStats((await statsRes.json()) as DashboardStats);
			}
			if (chartsRes.ok) {
				setChartData((await chartsRes.json()) as ChartPoint[]);
			}
		} catch {
			toast.danger("Failed to load dashboard data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	return (
		<div className="space-y-4 md:space-y-6">
			<div>
				<h1 className="text-basalt-xl md:text-basalt-3xl font-semibold">Dashboard</h1>
				<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
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
							index={0}
						/>
						<StatsCard
							label="Sent Today"
							value={String(stats?.total_sends_today ?? 0)}
							icon={Mail}
							index={1}
						/>
						<StatsCard
							label="Sent This Month"
							value={String(stats?.total_sends_month ?? 0)}
							icon={CalendarDays}
							index={2}
						/>
						<StatsCard
							label="Failed Today"
							value={String(stats?.total_failed_today ?? 0)}
							icon={AlertTriangle}
							accent="bg-basalt-destructive/10 text-basalt-destructive"
							index={3}
						/>
					</div>

					{/* Chart */}
					<SendsChart data={chartData ?? []} />
				</>
			)}
		</div>
	);
}
