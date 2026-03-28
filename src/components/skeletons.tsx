import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton loading states for all pages.
 * Each mirrors the real page layout using bg-secondary card shells.
 */

// ---------------------------------------------------------------------------
// Dashboard — 4 stat cards + chart area
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <Skeleton className="h-3 w-24 mb-4" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Projects list — 6 card grid
// ---------------------------------------------------------------------------

export function ProjectsListSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <div className="border-t border-border/50 pt-3 flex gap-4">
            <div className="space-y-1">
              <Skeleton className="h-2 w-14" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates list — grouped sections with row skeletons
// ---------------------------------------------------------------------------

export function TemplatesListSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 2 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="h-3 w-28 mb-3" />
          <div className="rounded-xl bg-secondary overflow-hidden divide-y divide-border/50">
            {Array.from({ length: 3 }).map((_, ri) => (
              <div key={ri} className="flex items-center justify-between px-4 py-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log table — header + rows (reusable for send-logs and webhook-logs)
// ---------------------------------------------------------------------------

export function LogTableSkeleton({ columns = 5 }: { columns?: number }) {
  const widths = ["w-14", "w-28", "w-20", "w-24", "w-16", "w-20"];

  return (
    <>
      {/* Filter bar */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-[180px] rounded-md" />
        <Skeleton className="h-9 w-[140px] rounded-md" />
      </div>

      {/* Table header */}
      <div>
        <div className="hidden md:flex items-center gap-3 px-4 py-2 border-b border-border">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={`h-3 ${widths[i % widths.length]}`} />
          ))}
        </div>

        {/* Table rows */}
        {Array.from({ length: 8 }).map((_, ri) => (
          <div
            key={ri}
            className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3 px-4 py-3 border-b border-border"
          >
            {Array.from({ length: columns }).map((_, ci) => (
              <Skeleton
                key={ci}
                className={`h-4 ${widths[ci % widths.length]}`}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
