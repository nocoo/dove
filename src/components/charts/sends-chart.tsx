import { LayerCard } from "@nocoo/basalt";
import {
	ANIMATION_PROPS,
	AXIS_CONFIG,
	BAR_RADIUS,
	CHART_PLOT_MARGIN,
	CHART_TOOLTIP_CURSOR_BAR,
	ChartFrame,
	ChartLegend,
	ChartTooltipContent,
	GRID_PROPS,
	getChartColor,
} from "@nocoo/basalt/components/chart";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ChartPoint {
	date: string;
	sent: number;
	failed: number;
}

export function SendsChart({ data }: { data: ChartPoint[] }) {
	const chartData = data.map((point) => ({
		...point,
		label: `${point.date.slice(5, 7)}/${point.date.slice(8, 10)}`,
	}));
	const totalSent = data.reduce((sum, point) => sum + point.sent, 0);
	const totalFailed = data.reduce((sum, point) => sum + point.failed, 0);
	const sentColor = getChartColor(0);
	const failedColor = "hsl(var(--basalt-destructive))";

	return (
		<LayerCard>
			<LayerCard.Header>
				<h2 className="text-basalt-base font-semibold">Sends Over Time</h2>
			</LayerCard.Header>
			<LayerCard.Body>
				{data.length === 0 ? (
					<div className="flex h-[200px] items-center justify-center">
						<p className="text-basalt-sm text-basalt-muted-foreground">No data available</p>
					</div>
				) : (
					<ChartFrame
						ariaLabel="Email sends over time"
						size="h-[200px]"
						summary={`${totalSent} sent and ${totalFailed} failed across ${data.length} days.`}
						dataAlternative={
							<table className="sr-only">
								<caption>Email sends by date</caption>
								<tbody>
									{data.map((point) => (
										<tr key={point.date}>
											<th>{point.date}</th>
											<td>{point.sent} sent</td>
											<td>{point.failed} failed</td>
										</tr>
									))}
								</tbody>
							</table>
						}
						legend={
							<ChartLegend
								items={[
									{ key: "sent", label: `Sent: ${totalSent}`, color: sentColor },
									{ key: "failed", label: `Failed: ${totalFailed}`, color: failedColor },
								]}
								shape="bar"
							/>
						}
					>
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={chartData} margin={CHART_PLOT_MARGIN}>
								<CartesianGrid {...GRID_PROPS} />
								<XAxis dataKey="label" {...AXIS_CONFIG} interval="preserveStartEnd" />
								<YAxis {...AXIS_CONFIG} allowDecimals={false} />
								<Tooltip
									content={<ChartTooltipContent formatter={(value) => String(value)} />}
									cursor={CHART_TOOLTIP_CURSOR_BAR}
									{...ANIMATION_PROPS}
								/>
								<Bar
									dataKey="sent"
									name="Sent"
									fill={sentColor}
									radius={BAR_RADIUS.vertical}
									stackId="sends"
								/>
								<Bar
									dataKey="failed"
									name="Failed"
									fill={failedColor}
									radius={BAR_RADIUS.vertical}
									stackId="sends"
								/>
							</BarChart>
						</ResponsiveContainer>
					</ChartFrame>
				)}
			</LayerCard.Body>
		</LayerCard>
	);
}
