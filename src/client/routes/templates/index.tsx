import { Button, toast } from "@nocoo/basalt";
import { FileText, Plus } from "@nocoo/basalt/icons";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { TemplatesListSkeleton } from "@/components/skeletons";

interface Template {
	id: string;
	project_id: string;
	slug: string;
	name: string;
	subject: string;
	body_markdown: string;
	variables: string | null;
	created_at: string;
	updated_at: string;
}

interface Project {
	id: string;
	name: string;
}

export function TemplatesPage() {
	const navigate = useNavigate();
	const [templates, setTemplates] = useState<Template[] | null>(null);
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const [templatesRes, projectsRes] = await Promise.all([
				fetch("/api/templates"),
				fetch("/api/projects"),
			]);

			if (templatesRes.ok) setTemplates((await templatesRes.json()) as Template[]);
			if (projectsRes.ok) setProjects((await projectsRes.json()) as Project[]);
		} catch {
			setError("Failed to load templates");
			toast.danger("Failed to load templates");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	// Group templates by project
	const projectMap = new Map(projects.map((p) => [p.id, p.name]));
	const grouped = new Map<string, Template[]>();
	if (templates) {
		for (const t of templates) {
			const list = grouped.get(t.project_id) ?? [];
			list.push(t);
			grouped.set(t.project_id, list);
		}
	}

	return (
		<div className="flex flex-col gap-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-basalt-xl md:text-basalt-3xl font-semibold">Templates</h1>
					<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
						Email templates across all projects.
					</p>
				</div>
				<Button size="sm" onClick={() => void navigate("/templates/new")}>
					<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
					New Template
				</Button>
			</div>

			{/* Content */}
			{loading && !templates ? (
				<TemplatesListSkeleton />
			) : error && !templates ? (
				<div className="rounded-lg border border-basalt-destructive/30 bg-basalt-destructive/5 p-6 text-center">
					<p className="text-basalt-sm text-basalt-destructive">{error}</p>
					<Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchData()}>
						Retry
					</Button>
				</div>
			) : templates && templates.length === 0 ? (
				<div className="rounded-basalt-lg bg-basalt-secondary p-8 text-center ring-1 ring-basalt-border/80 shadow-basalt-card">
					<FileText
						className="h-10 w-10 text-basalt-muted-foreground/40 mx-auto mb-3"
						strokeWidth={1.5}
					/>
					<p className="text-basalt-sm font-medium text-basalt-foreground">No templates yet</p>
					<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
						Create a template to define reusable email content.
					</p>
					<Button size="sm" className="mt-4" onClick={() => void navigate("/templates/new")}>
						<Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
						Create Template
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-6">
					{Array.from(grouped.entries()).map(([projectId, tmps]) => (
						<div key={projectId}>
							<h2 className="text-basalt-sm font-medium text-basalt-muted-foreground uppercase tracking-wide mb-3">
								{projectMap.get(projectId) ?? "Unknown Project"}
							</h2>
							<div className="divide-y divide-basalt-border/50 rounded-basalt-lg bg-basalt-secondary ring-1 ring-basalt-border/80 shadow-basalt-card overflow-hidden">
								{tmps.map((t) => (
									<Link
										key={t.id}
										to={`/templates/${t.id}`}
										className="flex items-center gap-3 px-4 py-3 hover:bg-basalt-hover/50 transition-colors duration-150"
									>
										<div className="min-w-0 flex-1">
											<p className="text-basalt-sm font-medium text-basalt-foreground truncate">
												{t.name}
											</p>
											<p className="text-basalt-xs text-basalt-muted-foreground mt-0.5 truncate">
												<span className="font-mono">{t.slug}</span>
												<span className="mx-1.5 text-basalt-border">·</span>
												<span>{t.subject}</span>
											</p>
										</div>
										<time className="hidden sm:block text-basalt-xs text-basalt-muted-foreground tabular-nums shrink-0">
											{new Date(t.updated_at).toLocaleDateString(undefined, {
												month: "short",
												day: "numeric",
											})}
										</time>
									</Link>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
