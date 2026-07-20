import {
	AlertCircle,
	ArrowRight,
	CheckCircle2,
	Loader2,
	Plus,
	Server,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ProjectsListSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProviderSummary {
	id: string;
	name: string;
	type: "resend" | "cloudflare";
	domain: string;
	config: Record<string, string>;
	created_at: string;
	updated_at: string;
}

interface HealthStatus {
	healthy: boolean;
	configValid: boolean;
	configError: string | null;
	reachable: boolean | null;
	reachableError: string | null;
	checkedAt: string;
}

function HealthBadge({ loading, health }: { loading: boolean; health: HealthStatus | null }) {
	if (loading) {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<Loader2 className="h-3 w-3 animate-spin" />
				Checking…
			</span>
		);
	}
	if (!health) {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<AlertCircle className="h-3 w-3" strokeWidth={1.5} />
				Unknown
			</span>
		);
	}
	if (!health.configValid) {
		return (
			<span
				className="inline-flex items-center gap-1 text-xs text-destructive"
				title={health.configError ?? "Invalid config"}
			>
				<XCircle className="h-3 w-3" strokeWidth={1.5} />
				Invalid config
			</span>
		);
	}
	if (health.reachable === false) {
		return (
			<span
				className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
				title={health.reachableError ?? "Unreachable"}
			>
				<AlertCircle className="h-3 w-3" strokeWidth={1.5} />
				Unreachable
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
			<CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
			Healthy
		</span>
	);
}

export function ProvidersPage() {
	const navigate = useNavigate();
	const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [healthById, setHealthById] = useState<Record<string, HealthStatus>>({});
	const [healthLoadingById, setHealthLoadingById] = useState<Record<string, boolean>>({});

	const fetchProviders = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const res = await fetch("/api/providers");
			if (!res.ok) throw new Error("Failed to fetch providers");
			setProviders((await res.json()) as ProviderSummary[]);
		} catch {
			setError("Failed to load providers");
			toast.error("Failed to load providers");
		} finally {
			setLoading(false);
		}
	}, []);

	const fetchHealth = useCallback(async (id: string) => {
		setHealthLoadingById((m) => ({ ...m, [id]: true }));
		try {
			const res = await fetch(`/api/providers/${id}/health`);
			if (!res.ok) return;
			const h = (await res.json()) as HealthStatus;
			setHealthById((m) => ({ ...m, [id]: h }));
		} catch {
			// leave as unknown
		} finally {
			setHealthLoadingById((m) => ({ ...m, [id]: false }));
		}
	}, []);

	useEffect(() => {
		void fetchProviders();
	}, [fetchProviders]);

	useEffect(() => {
		if (!providers) return;
		for (const p of providers) {
			void fetchHealth(p.id);
		}
	}, [providers, fetchHealth]);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl md:text-2xl font-semibold font-display">Providers</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Outbound email backends. Each project picks one; health here is a cheap probe, not a
						guarantee of delivery.
					</p>
				</div>
				<Button size="sm" onClick={() => void navigate("/providers/new")}>
					<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
					New Provider
				</Button>
			</div>

			{loading && !providers ? (
				<ProjectsListSkeleton />
			) : error && !providers ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
					<p className="text-sm text-destructive">{error}</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void fetchProviders()}
					>
						Retry
					</Button>
				</div>
			) : providers && providers.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center">
					<Server className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
					<p className="text-sm font-medium text-foreground">No providers configured</p>
					<p className="text-sm text-muted-foreground mt-1">
						Add a Resend or Cloudflare provider to start sending emails.
					</p>
					<Button size="sm" className="mt-4" onClick={() => void navigate("/providers/new")}>
						<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
						Create Provider
					</Button>
				</div>
			) : (
				<div className="relative">
					{loading && providers && (
						<div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg z-10">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					)}
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
						{providers?.map((p) => (
							<Link
								key={p.id}
								to={`/providers/${p.id}`}
								className={cn(
									"group rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 transition-colors hover:bg-accent/60",
								)}
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2.5 min-w-0">
										<div className="shrink-0 rounded-md bg-card p-1.5">
											<Server className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
										</div>
										<div className="min-w-0">
											<p className="text-sm font-medium text-foreground truncate">{p.name}</p>
											<p className="text-xs text-muted-foreground truncate">
												{p.type} · {p.domain}
											</p>
										</div>
									</div>
									<ArrowRight
										className="shrink-0 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2"
										strokeWidth={1.5}
									/>
								</div>
								<div className="pl-[34px] mt-2">
									<HealthBadge
										loading={healthLoadingById[p.id] ?? false}
										health={healthById[p.id] ?? null}
									/>
								</div>
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
