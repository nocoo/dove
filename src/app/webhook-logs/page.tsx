"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ScrollText, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generatePageNumbers } from "@/lib/pagination";
import { LogTableSkeleton } from "@/components/skeletons";

interface WebhookLog {
  id: string;
  project_id: string;
  method: string;
  path: string;
  status_code: number;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;

function statusCodeVariant(code: number): "default" | "secondary" | "destructive" | "outline" {
  if (code >= 200 && code < 300) return "default";
  if (code >= 400 && code < 500) return "secondary";
  if (code >= 500) return "destructive";
  return "outline";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function WebhookLogsPage() {
  const [logs, setLogs] = useState<WebhookLog[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterProject, setFilterProject] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = filterProject !== "all";

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      if (filterProject !== "all") params.set("projectId", filterProject);

      const [logsRes, projectsRes] = await Promise.all([
        fetch(`/api/webhook-logs?${params.toString()}`),
        fetch("/api/projects"),
      ]);

      if (logsRes.ok) {
        const data = await logsRes.json() as WebhookLog[];
        setLogs(data);
        setTotal(
          data.length < PAGE_SIZE
            ? (page - 1) * PAGE_SIZE + data.length
            : (page + 1) * PAGE_SIZE,
        );
      }
      if (projectsRes.ok) setProjects(await projectsRes.json() as Project[]);
    } catch {
      setError("Failed to load webhook logs");
      toast.error("Failed to load webhook logs");
    } finally {
      setLoading(false);
    }
  }, [page, filterProject]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  function clearFilters() {
    setFilterProject("all");
    setPage(1);
  }

  return (
    <AppShell breadcrumbs={[{ label: "Webhook Logs", href: "/webhook-logs" }]}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Webhook Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fire-and-forget request logs for observability.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterProject} onValueChange={(v) => { setFilterProject(v); setPage(1); }}>
            <SelectTrigger className="w-[180px] h-9 text-sm">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs text-muted-foreground">
              <X className="h-3 w-3 mr-1" strokeWidth={1.5} />
              Clear filters
            </Button>
          )}
        </div>

        {/* Content */}
        {loading && !logs ? (
          <LogTableSkeleton columns={6} />
        ) : error && !logs ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchData()}>
              Retry
            </Button>
          </div>
        ) : logs && logs.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center">
            <ScrollText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">
              {hasFilters ? "No logs match your filters" : "No webhook logs yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters
                ? "Try adjusting your filters."
                : "Webhook logs will appear here when API requests are made."}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="relative">
            {loading && logs && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg z-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Table header — desktop */}
            <div className="hidden md:flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground border-b border-border">
              <div className="w-[60px] shrink-0">Status</div>
              <div className="w-[60px] shrink-0">Method</div>
              <div className="flex-1 min-w-0">Path</div>
              <div className="w-[120px] shrink-0">Project</div>
              <div className="w-[80px] shrink-0 text-right">Duration</div>
              <div className="w-[140px] shrink-0">Date</div>
            </div>

            <div className="flex flex-col">
              {logs?.map((log) => (
                <div key={log.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    className="w-full flex flex-col gap-1 md:flex-row md:items-center md:gap-3 px-4 py-3 text-left border-b border-border hover:bg-muted/30 transition-colors"
                  >
                    <div className="w-[60px] shrink-0">
                      <Badge variant={statusCodeVariant(log.status_code)} className="text-[10px] font-mono">
                        {log.status_code}
                      </Badge>
                    </div>
                    <div className="w-[60px] shrink-0">
                      <span className="text-xs font-mono text-muted-foreground">{log.method}</span>
                    </div>
                    <div className="flex-1 min-w-0 truncate text-xs font-mono text-foreground">
                      {log.path}
                    </div>
                    <div className="w-[120px] shrink-0 text-xs text-muted-foreground truncate">
                      {projectMap.get(log.project_id) ?? log.project_id.slice(0, 8)}
                    </div>
                    <div className="w-[80px] shrink-0 text-xs text-muted-foreground text-right tabular-nums">
                      {log.duration_ms !== null ? `${log.duration_ms}ms` : "—"}
                    </div>
                    <div className="w-[140px] shrink-0 text-xs text-muted-foreground">
                      {formatDate(log.created_at)}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expandedId === log.id && (
                    <div className="mx-4 mb-1 rounded-b-lg border border-t-0 border-border bg-muted/30 px-4 py-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <span className="text-xs text-muted-foreground block mb-0.5">ID</span>
                          <span className="text-xs font-mono text-foreground break-all">{log.id}</span>
                        </div>
                        {log.error_code && (
                          <div>
                            <span className="text-xs text-muted-foreground block mb-0.5">Error Code</span>
                            <span className="text-xs font-mono text-destructive">{log.error_code}</span>
                          </div>
                        )}
                        {log.error_message && (
                          <div className="md:col-span-2">
                            <span className="text-xs text-muted-foreground block mb-0.5">Error Message</span>
                            <span className="text-xs text-destructive break-all">{log.error_message}</span>
                          </div>
                        )}
                        {log.ip && (
                          <div>
                            <span className="text-xs text-muted-foreground block mb-0.5">IP Address</span>
                            <span className="text-xs font-mono text-foreground">{log.ip}</span>
                          </div>
                        )}
                        {log.user_agent && (
                          <div className="md:col-span-2">
                            <span className="text-xs text-muted-foreground block mb-0.5">User Agent</span>
                            <span className="text-xs text-foreground break-all">{log.user_agent}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-xs text-muted-foreground block mb-0.5">Created</span>
                          <span className="text-xs text-foreground">{formatDate(log.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                  {generatePageNumbers(page, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="px-1 text-xs text-muted-foreground">...</span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(p)}
                        className="h-8 w-8 p-0 text-xs"
                      >
                        {p}
                      </Button>
                    ),
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
