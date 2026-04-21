import type { ReactNode } from "react";
import { AppShell } from "../components/layout/app-shell";

interface LayoutProps {
  children: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

export function Layout({ children, breadcrumbs }: LayoutProps) {
  return <AppShell breadcrumbs={breadcrumbs}>{children}</AppShell>;
}
