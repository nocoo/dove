"use client";

import { AppShell } from "@/components/layout/app-shell";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          Email relay stats, quota usage, and recent activity will appear here.
        </p>
      </div>
    </AppShell>
  );
}
