"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  PanelLeft,
  LogOut,
  ScrollText,
  Mail,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { useSidebar } from "./sidebar-context";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";

import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/templates", label: "Templates", icon: FileText },
    ],
  },
  {
    label: "Monitoring",
    defaultOpen: true,
    items: [
      { href: "/send-logs", label: "Send Logs", icon: Mail },
      { href: "/webhook-logs", label: "Webhook Logs", icon: ScrollText },
    ],
  },
];

// Flat list for collapsed view
const allNavItems = navGroups.flatMap((g) => g.items);

function NavGroupSection({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="px-3 mt-2">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 cursor-pointer">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </span>
          <ChevronUp
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
              !open && "rotate-180",
            )}
            strokeWidth={1.5}
          />
        </CollapsibleTrigger>
      </div>
      {/* CSS grid animation for smooth height transition (basalt pattern) */}
      <div
        className="grid overflow-hidden"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 px-3">
            {group.items.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="flex-1 text-left">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const { data: session } = useSession();

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col bg-background transition-all duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-[68px]" : "w-[260px]",
      )}
    >
      {collapsed ? (
        /* Collapsed (icon-only) view */
        <div className="flex h-screen w-[68px] flex-col items-center">
          {/* Logo */}
          <div className="flex h-14 w-full items-center justify-center">
            <Image src="/logo-24.png" alt="dove" width={24} height={24} />
          </div>

          {/* Expand toggle */}
          <button
            onClick={toggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-2"
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
          </button>

          {/* Navigation (flat icons when collapsed) */}
          <nav className="flex-1 flex flex-col items-center gap-1 overflow-y-auto pt-1">
            {allNavItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" strokeWidth={1.5} />
                </Link>
              );
            })}
          </nav>

          {/* User sign out */}
          <div className="py-3 flex justify-center w-full">
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title={`${userName} - Sign out`}
              className="flex h-9 w-9 items-center justify-center rounded-full overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
            >
              {userImage ? (
                <Image
                  src={userImage}
                  alt={userName}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {userInitial}
                </span>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Expanded view */
        <div className="flex h-screen w-[260px] flex-col">
          {/* Header: logo + collapse toggle */}
          <div className="px-3 h-14 flex items-center">
            <div className="flex w-full items-center justify-between px-3">
              <div className="flex items-center gap-3">
                <Image src="/logo-24.png" alt="dove" width={24} height={24} />
                <span className="text-lg font-bold tracking-tighter">dove</span>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  v{APP_VERSION}
                </span>
              </div>
              <button
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                <PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Navigation with groups */}
          <nav className="flex-1 overflow-y-auto pt-1">
            {navGroups.map((group) => (
              <NavGroupSection
                key={group.label}
                group={group}
                pathname={pathname}
              />
            ))}
          </nav>

          {/* User info + sign out */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full overflow-hidden">
                {userImage ? (
                  <Image
                    src={userImage}
                    alt={userName}
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {userInitial}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{userName}</p>
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
