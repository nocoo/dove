"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SortHeader } from "@/components/sort-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generatePageNumbers } from "@/lib/pagination";
import { LogTableSkeleton } from "@/components/skeletons";

interface SendLog {
  id: string;
  project_id: string;
  idempotency_key: string | null;
  payload_hash: string | null;
  template_id: string | null;
  recipient_id: string | null;
  to_email: string;
  subject: string;
  status: "sending" | "sent" | "failed";
  resend_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

interface Project {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "sent":
      return "default";
    case "sending":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SendLogsPage() {
  const [logs, setLogs] = useState<SendLog[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sort state
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = filterProject !== "all" || filterStatus !== "all";

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      if (filterProject !== "all") params.set("projectId", filterProject);
      if (filterStatus !== "all") params.set("status", filterStatus);

      const [logsRes, projectsRes] = await Promise.all([
        fetch(`/api/send-logs?${params.toString()}`),
        fetch("/api/projects"),
      ]);

      if (logsRes.ok) {
        const data = await logsRes.json() as SendLog[];
        setLogs(data);
        // Estimate total for pagination (if we get a full page, there might be more)
        setTotal(
          data.length < PAGE_SIZE
            ? (page - 1) * PAGE_SIZE + data.length
            : (page + 1) * PAGE_SIZE,
        );
      }
      if (projectsRes.ok) setProjects(await projectsRes.json() as Project[]);
    } catch {
      setError("Failed to load send logs");
      toast.error("Failed to load send logs");
    } finally {
      setLoading(false);
    }
  }, [page, filterProject, filterStatus]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const sortedLogs = useMemo(() => {
    if (!logs) return null;
    return [...logs].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortKey) {
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "to_email":
          aVal = a.to_email.toLowerCase();
          bVal = b.to_email.toLowerCase();
          break;
        case "subject":
          aVal = a.subject.toLowerCase();
          bVal = b.subject.toLowerCase();
          break;
        case "project":
          aVal = (projectMap.get(a.project_id) ?? a.project_id).toLowerCase();
          bVal = (projectMap.get(b.project_id) ?? b.project_id).toLowerCase();
          break;
        case "created_at":
        default:
          aVal = a.created_at;
          bVal = b.created_at;
          break;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [logs, sortKey, sortDir, projectMap]);

  function clearFilters() {
    setFilterProject("all");
    setFilterStatus("all");
    setPage(1);
  }

  return (
    <AppShell breadcrumbs={[{ label: "Send Logs", href: "/send-logs" }]}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Send Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Authoritative email send history.
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

          <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="sending">Sending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
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
          <LogTableSkeleton columns={5} />
        ) : error && !logs ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchData()}>
              Retry
            </Button>
          </div>
        ) : logs && logs.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center">
            <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">
              {hasFilters ? "No logs match your filters" : "No send logs yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters
                ? "Try adjusting your filters."
                : "Send logs will appear here when emails are sent via webhooks."}
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
              <SortHeader label="Status" sortKey="status" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[80px] shrink-0" />
              <SortHeader label="Recipient" sortKey="to_email" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="flex-1 min-w-0" />
              <SortHeader label="Subject" sortKey="subject" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[200px] shrink-0" />
              <SortHeader label="Project" sortKey="project" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[120px] shrink-0" />
              <SortHeader label="Date" sortKey="created_at" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[130px] shrink-0" />
            </div>

            <div className="flex flex-col">
              {sortedLogs?.map((log) => (
                <div key={log.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    className="w-full flex flex-col gap-1 md:flex-row md:items-center md:gap-3 px-4 py-3 text-left border-b border-border hover:bg-muted/30 transition-colors"
                  >
                    <div className="w-[80px] shrink-0">
                      <Badge variant={statusVariant(log.status)} className="text-[10px]">
                        {log.status}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0 truncate text-sm text-foreground">
                      {log.to_email}
                    </div>
                    <div className="w-[200px] shrink-0 truncate text-xs text-muted-foreground">
                      {log.subject}
                    </div>
                    <div className="w-[120px] shrink-0 text-xs text-muted-foreground truncate">
                      {projectMap.get(log.project_id) ?? log.project_id.slice(0, 8)}
                    </div>
                    <div className="w-[130px] shrink-0 text-xs text-muted-foreground">
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
                        {log.resend_id && (
                          <div>
                            <span className="text-xs text-muted-foreground block mb-0.5">Resend ID</span>
                            <span className="text-xs font-mono text-foreground break-all">{log.resend_id}</span>
                          </div>
                        )}
                        {log.idempotency_key && (
                          <div>
                            <span className="text-xs text-muted-foreground block mb-0.5">Idempotency Key</span>
                            <span className="text-xs font-mono text-foreground break-all">{log.idempotency_key}</span>
                          </div>
                        )}
                        {log.error_message && (
                          <div className="md:col-span-2">
                            <span className="text-xs text-muted-foreground block mb-0.5">Error</span>
                            <span className="text-xs text-destructive break-all">{log.error_message}</span>
                          </div>
                        )}
                        {log.sent_at && (
                          <div>
                            <span className="text-xs text-muted-foreground block mb-0.5">Sent At</span>
                            <span className="text-xs text-foreground">{formatDate(log.sent_at)}</span>
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
