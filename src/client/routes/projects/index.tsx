import { Button, toast } from "@nocoo/basalt";
import { ArrowRight, FolderKanban, Loader2, Mail, Plus } from "@nocoo/basalt/icons";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ProjectsListSkeleton } from "@/components/skeletons";

interface ProjectSummary {
	id: string;
	name: string;
	description: string | null;
	email_prefix: string;
	from_name: string;
	quota_daily: number;
	quota_monthly: number;
	created_at: string;
	updated_at: string;
}

export function ProjectsPage() {
	const navigate = useNavigate();
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchProjects = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const res = await fetch("/api/projects");
			if (!res.ok) throw new Error("Failed to fetch projects");
			setProjects((await res.json()) as ProjectSummary[]);
		} catch {
			setError("Failed to load projects");
			toast.error("Failed to load projects");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchProjects();
	}, [fetchProjects]);

	return (
		<div className="flex flex-col gap-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-basalt-xl md:text-basalt-3xl font-semibold">Projects</h1>
					<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
						Manage email relay projects, quotas, and webhook tokens.
					</p>
				</div>
				<Button size="sm" onClick={() => void navigate("/projects/new")}>
					<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
					New Project
				</Button>
			</div>

			{/* Content */}
			{loading && !projects ? (
				<ProjectsListSkeleton />
			) : error && !projects ? (
				<div className="rounded-lg border border-basalt-destructive/30 bg-basalt-destructive/5 p-6 text-center">
					<p className="text-basalt-sm text-basalt-destructive">{error}</p>
					<Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchProjects()}>
						Retry
					</Button>
				</div>
			) : projects && projects.length === 0 ? (
				<div className="rounded-basalt-lg bg-basalt-secondary p-8 text-center ring-1 ring-basalt-border/80 shadow-basalt-card">
					<FolderKanban
						className="h-10 w-10 text-basalt-muted-foreground/40 mx-auto mb-3"
						strokeWidth={1.5}
					/>
					<p className="text-basalt-sm font-medium text-basalt-foreground">No projects yet</p>
					<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
						Create your first project to start sending emails.
					</p>
					<Button size="sm" className="mt-4" onClick={() => void navigate("/projects/new")}>
						<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
						Create Project
					</Button>
				</div>
			) : (
				<div className="relative">
					{/* Loading overlay for refetches */}
					{loading && projects && (
						<div className="absolute inset-0 flex items-center justify-center bg-basalt-background/50 rounded-lg z-10">
							<Loader2 className="h-5 w-5 animate-spin text-basalt-muted-foreground" />
						</div>
					)}

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
						{projects?.map((project) => (
							<Link
								key={project.id}
								to={`/projects/${project.id}`}
								className="group rounded-basalt-lg bg-basalt-secondary p-4 md:p-5 ring-1 ring-basalt-border/80 shadow-basalt-card transition-colors hover:bg-basalt-hover/60"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2.5 min-w-0">
										<div className="shrink-0 rounded-md bg-basalt-card p-1.5">
											<Mail className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
										</div>
										<div className="min-w-0">
											<p className="text-basalt-sm font-medium text-basalt-foreground truncate">
												{project.name}
											</p>
											<p className="text-basalt-xs text-basalt-muted-foreground truncate">
												{project.from_name} · {project.email_prefix} · {project.quota_daily}/day ·{" "}
												{project.quota_monthly}/mo
											</p>
										</div>
									</div>
									<ArrowRight
										className="shrink-0 h-3.5 w-3.5 text-basalt-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2"
										strokeWidth={1.5}
									/>
								</div>

								{project.description && (
									<p className="text-basalt-xs text-basalt-muted-foreground mt-2 line-clamp-1 pl-[34px]">
										{project.description}
									</p>
								)}
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
