import { ThemeToggle } from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { ContentIsland, SidebarDrawer, SidebarProvider } from "@nocoo/basalt/components/sidebar";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppSidebar } from "./sidebar";

interface AppShellProps {
	children: React.ReactNode;
	breadcrumbs?: { label: string; href?: string }[] | undefined;
}

function routeTitle(pathname: string) {
	if (pathname === "/projects/new") return "New Project";
	if (pathname.startsWith("/projects/")) return "Project";
	if (pathname === "/projects") return "Projects";
	if (pathname === "/providers/new") return "New Provider";
	if (pathname.startsWith("/providers/")) return "Provider";
	if (pathname === "/providers") return "Providers";
	if (pathname === "/templates/new") return "New Template";
	if (pathname.startsWith("/templates/")) return "Template";
	if (pathname === "/templates") return "Templates";
	if (pathname === "/send-logs") return "Send Logs";
	if (pathname === "/webhook-logs") return "Webhook Logs";
	return "Dashboard";
}

export function AppShell({ children, breadcrumbs = [] }: AppShellProps) {
	const [collapsed, setCollapsed] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const isMobile = useIsMobile();
	const { pathname } = useLocation();
	const mobileTriggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void pathname;
		setMobileOpen(false);
	}, [pathname]);

	const currentBreadcrumbs =
		breadcrumbs.length > 0
			? [{ href: "/", label: "Home" }, ...breadcrumbs]
			: pathname === "/"
				? [{ label: "Dashboard" }]
				: [{ href: "/", label: "Home" }, { label: routeTitle(pathname) }];

	return (
		<SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed}>
			<BasaltAppShell layout="workspace">
				<AppSkipLink>Skip to main content</AppSkipLink>
				{!isMobile && <AppSidebar />}
				<AppMain>
					<AppHeader
						leading={
							isMobile ? (
								<AppHeaderMenuButton
									ref={mobileTriggerRef}
									onClick={() => setMobileOpen(true)}
									aria-controls="mobile-navigation"
								/>
							) : undefined
						}
						breadcrumbs={currentBreadcrumbs}
						actions={
							<>
								<ProjectLinks github="nocoo/dove" hexly="dove" name="Dove" />
								<ThemeToggle aria-label="Change theme" />
							</>
						}
					/>
					<div className="flex min-h-0 min-w-0 flex-1 px-basalt-space-lg pb-basalt-space-lg md:px-basalt-layout-sm md:pb-basalt-layout-sm">
						<ContentIsland>{children}</ContentIsland>
					</div>
				</AppMain>
				{isMobile && (
					<SidebarDrawer
						open={mobileOpen}
						onOpenChange={setMobileOpen}
						id="mobile-navigation"
						returnFocusRef={mobileTriggerRef}
					>
						<AppSidebar resizable={false} onDismiss={() => setMobileOpen(false)} />
					</SidebarDrawer>
				)}
			</BasaltAppShell>
		</SidebarProvider>
	);
}
