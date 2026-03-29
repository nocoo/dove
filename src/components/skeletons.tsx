import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton loading states for all pages.
 * Each mirrors the real page layout using bg-secondary card shells.
 */

// ---------------------------------------------------------------------------
// Reusable card skeleton shell
// ---------------------------------------------------------------------------

function CardSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-0">
      <div className="px-5 py-4 space-y-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="px-5 pb-4">{children}</div>
    </div>
  );
}

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
          className="rounded-[var(--radius-card)] bg-secondary px-3.5 py-3"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            <div className="space-y-1.5 flex-1 min-w-0">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3 w-full max-w-[200px]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project detail — Settings + Token + Recipients + Templates + Danger Zone
// ---------------------------------------------------------------------------

export function ProjectDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Settings card */}
      <CardSkeleton>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        </div>
      </CardSkeleton>

      {/* Token card */}
      <CardSkeleton>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>
      </CardSkeleton>

      {/* Recipients card */}
      <CardSkeleton>
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </CardSkeleton>

      {/* Templates card */}
      <CardSkeleton>
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </CardSkeleton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template detail — two-column: editor left, preview right
// ---------------------------------------------------------------------------

export function TemplateDetailSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: editor */}
      <div className="flex flex-col gap-6">
        {/* Settings */}
        <CardSkeleton>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        </CardSkeleton>

        {/* Body */}
        <CardSkeleton>
          <Skeleton className="h-[320px] w-full rounded-md" />
        </CardSkeleton>

        {/* Variables */}
        <CardSkeleton>
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </CardSkeleton>
      </div>

      {/* Right: preview */}
      <div>
        <CardSkeleton>
          <Skeleton className="h-[400px] w-full rounded-md" />
        </CardSkeleton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New template form skeleton (Suspense fallback)
// ---------------------------------------------------------------------------

export function NewTemplateFormSkeleton() {
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Project selector */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      {/* Name + Slug */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      </div>
      {/* Subject */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      {/* Body */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-[200px] w-full rounded-md" />
      </div>
      {/* Buttons */}
      <div className="flex items-center gap-3 pt-1">
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login page skeleton (Suspense fallback)
// ---------------------------------------------------------------------------

export function LoginSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-20 w-20 rounded-2xl" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
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
              <div key={ri} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="hidden sm:block h-3 w-14 shrink-0" />
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
