"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ChartPoint {
  date: string;
  sent: number;
  failed: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-xs text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full mr-1.5"
            style={{ backgroundColor: entry.color }}
          />
          {entry.dataKey === "sent" ? "Sent" : "Failed"}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export function SendsChart({ data }: { data: ChartPoint[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sends Over Time</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] items-center justify-center">
            <p className="text-sm text-muted-foreground">No data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Format dates for display (MM/DD)
  const chartData = data.map((d) => ({
    ...d,
    label: `${d.date.slice(5, 7)}/${d.date.slice(8, 10)}`,
  }));

  const totalSent = data.reduce((sum, d) => sum + d.sent, 0);
  const totalFailed = data.reduce((sum, d) => sum + d.failed, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Sends Over Time</CardTitle>
        <CardDescription>Last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={chartData}
            margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              isAnimationActive={false}
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
            />
            <Bar
              dataKey="sent"
              fill="hsl(var(--chart-1))"
              radius={[3, 3, 0, 0]}
              stackId="a"
            />
            <Bar
              dataKey="failed"
              fill="hsl(var(--chart-5))"
              radius={[3, 3, 0, 0]}
              stackId="a"
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex items-center gap-6 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--chart-1))" }} />
            <span className="text-xs text-muted-foreground">
              Sent: <span className="font-medium text-foreground">{totalSent}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "hsl(var(--chart-5))" }} />
            <span className="text-xs text-muted-foreground">
              Failed: <span className="font-medium text-foreground">{totalFailed}</span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
