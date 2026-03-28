"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FileText } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

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

export default function TemplatesPage() {
  const router = useRouter();
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

      if (templatesRes.ok) setTemplates(await templatesRes.json() as Template[]);
      if (projectsRes.ok) setProjects(await projectsRes.json() as Project[]);
    } catch {
      setError("Failed to load templates");
      toast.error("Failed to load templates");
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
    <AppShell breadcrumbs={[{ label: "Templates", href: "/templates" }]}>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Email templates across all projects.
            </p>
          </div>
          <Button size="sm" onClick={() => router.push("/templates/new")}>
            <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
            New Template
          </Button>
        </div>

        {/* Content */}
        {loading && !templates ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error && !templates ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchData()}>
              Retry
            </Button>
          </div>
        ) : templates && templates.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">No templates yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a template to define reusable email content.
            </p>
            <Button size="sm" className="mt-4" onClick={() => router.push("/templates/new")}>
              <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              Create Template
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {Array.from(grouped.entries()).map(([projectId, tmps]) => (
              <div key={projectId}>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  {projectMap.get(projectId) ?? "Unknown Project"}
                </h2>
                <div className="divide-y divide-border/50 rounded-xl bg-secondary overflow-hidden">
                  {tmps.map((t) => (
                    <Link
                      key={t.id}
                      href={`/templates/${t.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{t.slug}</p>
                      </div>
                      <p className="text-xs text-muted-foreground ml-4 shrink-0">{t.subject}</p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
