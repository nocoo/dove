"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FolderKanban, Mail, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

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

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      setProjects(await res.json() as ProjectSummary[]);
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
    <AppShell breadcrumbs={[{ label: "Projects", href: "/projects" }]}>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage email relay projects, quotas, and webhook tokens.
            </p>
          </div>
          <Button size="sm" onClick={() => router.push("/projects/new")}>
            <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
            New Project
          </Button>
        </div>

        {/* Content */}
        {loading && !projects ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error && !projects ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchProjects()}>
              Retry
            </Button>
          </div>
        ) : projects && projects.length === 0 ? (
          <div className="rounded-lg border border-border bg-background/50 p-12 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">No projects yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first project to start sending emails.
            </p>
            <Button size="sm" className="mt-4" onClick={() => router.push("/projects/new")}>
              <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              Create Project
            </Button>
          </div>
        ) : (
          <div className="relative">
            {/* Loading overlay for refetches */}
            {loading && projects && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg z-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects?.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="group rounded-lg border border-border bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/80"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <Mail className="h-4 w-4 text-primary" strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{project.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {project.email_prefix}@...
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" strokeWidth={1.5} />
                  </div>

                  {project.description && (
                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2">
                      {project.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Daily Quota</p>
                      <p className="text-xs font-medium text-foreground">{project.quota_daily}/day</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly Quota</p>
                      <p className="text-xs font-medium text-foreground">{project.quota_monthly}/mo</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
