import type { LucideIcon } from "lucide-react";
import {
	ChevronUp,
	FileText,
	FolderKanban,
	LayoutDashboard,
	LogOut,
	Mail,
	PanelLeft,
	ScrollText,
	Server,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { signOut } from "../../lib/auth";
import { useAuth } from "../auth-provider";
import { useSidebar } from "./sidebar-context";

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
			{ href: "/providers", label: "Providers", icon: Server },
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

const allNavItems = navGroups.flatMap((g) => g.items);

function NavGroupSection({ group, pathname }: { group: NavGroup; pathname: string }) {
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
								item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

							return (
								<Link
									key={item.href}
									to={item.href}
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
	const { pathname } = useLocation();
	const { collapsed, toggle } = useSidebar();
	const { user } = useAuth();

	const userName = user?.name ?? "User";
	const userEmail = user?.email ?? "";
	const userInitial = userName[0] ?? "?";

	return (
		<aside
			className={cn(
				"sticky top-0 flex h-screen shrink-0 flex-col bg-background transition-[width] duration-300 ease-in-out overflow-hidden",
				collapsed ? "w-[68px]" : "w-[260px]",
			)}
		>
			{collapsed ? (
				<div className="flex h-screen w-[68px] flex-col items-center">
					<div className="flex h-14 w-full items-center justify-start pl-6 pr-3">
						<img src="/logo-24.png" alt="dove" width={24} height={24} />
					</div>

					<Tooltip delayDuration={0}>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={toggle}
								aria-label="Expand sidebar"
								className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-2"
							>
								<PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
							</button>
						</TooltipTrigger>
						<TooltipContent side="right" sideOffset={8}>
							Expand sidebar
						</TooltipContent>
					</Tooltip>

					<nav className="flex-1 flex flex-col items-center gap-1 overflow-y-auto pt-1">
						{allNavItems.map((item) => {
							const isActive =
								item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

							return (
								<Tooltip key={item.href} delayDuration={0}>
									<TooltipTrigger asChild>
										<Link
											to={item.href}
											className={cn(
												"relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
												isActive
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
										>
											<item.icon className="h-4 w-4" strokeWidth={1.5} />
										</Link>
									</TooltipTrigger>
									<TooltipContent side="right" sideOffset={8}>
										{item.label}
									</TooltipContent>
								</Tooltip>
							);
						})}
					</nav>

					<div className="py-3 flex justify-center w-full">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all rounded-full"
									aria-label="User menu"
								>
									<Avatar className="h-9 w-9">
										<AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
									</Avatar>
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="right" align="end" sideOffset={8}>
								<DropdownMenuLabel>
									<p className="text-sm font-medium">{userName}</p>
									{userEmail && <p className="text-xs text-muted-foreground">{userEmail}</p>}
								</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => void signOut()}>
									<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
									Sign out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			) : (
				<div className="flex h-screen w-[260px] flex-col">
					<div className="px-3 h-14 flex items-center">
						<div className="flex w-full items-center justify-between px-3">
							<div className="flex items-center gap-3">
								<img src="/logo-24.png" alt="dove" width={24} height={24} />
								<span className="text-lg font-bold tracking-tighter">dove</span>
								<span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium leading-none text-muted-foreground">
									v{APP_VERSION}
								</span>
							</div>
							<button
								type="button"
								onClick={toggle}
								aria-label="Collapse sidebar"
								className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
							>
								<PanelLeft className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
							</button>
						</div>
					</div>

					<nav className="flex-1 overflow-y-auto pt-1">
						{navGroups.map((group) => (
							<NavGroupSection key={group.label} group={group} pathname={pathname} />
						))}
					</nav>

					<div className="px-4 py-3">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer"
								>
									<Avatar className="h-9 w-9 shrink-0">
										<AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
									</Avatar>
									<div className="flex-1 min-w-0 text-left">
										<p className="text-sm font-medium text-foreground truncate">{userName}</p>
										<p className="text-xs text-muted-foreground truncate">{userEmail}</p>
									</div>
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="start"
								sideOffset={8}
								className="w-[--radix-dropdown-menu-trigger-width]"
							>
								<DropdownMenuLabel>
									<p className="text-sm font-medium">{userName}</p>
									{userEmail && <p className="text-xs text-muted-foreground">{userEmail}</p>}
								</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => void signOut()}>
									<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
									Sign out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			)}
		</aside>
	);
}
