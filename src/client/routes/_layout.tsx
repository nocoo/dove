import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

/**
 * Root layout — AppShell skeleton.
 *
 * Will be replaced with full sidebar/header in Phase E.
 */
export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <main className="flex-1">{children}</main>
    </div>
  );
}
