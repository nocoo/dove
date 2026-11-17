import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt";
import {
	Sidebar,
	SidebarBrand,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarItem,
	SidebarNav,
	SidebarToggle,
	SidebarUser,
} from "@nocoo/basalt/components/sidebar";
import {
	FileText,
	FolderKanban,
	LayoutDashboard,
	type LucideIcon,
	Mail,
	ScrollText,
	Server,
} from "@nocoo/basalt/icons";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { APP_VERSION } from "@/lib/version";
import { signOut } from "../../lib/auth";
import { useAuth } from "../auth-provider";

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
}

interface NavGroup {
	label: string;
	items: NavItem[];
}

const navGroups: NavGroup[] = [
	{
		label: "Overview",
		items: [
			{ href: "/", label: "Dashboard", icon: LayoutDashboard },
			{ href: "/projects", label: "Projects", icon: FolderKanban },
			{ href: "/providers", label: "Providers", icon: Server },
			{ href: "/templates", label: "Templates", icon: FileText },
		],
	},
	{
		label: "Monitoring",
		items: [
			{ href: "/send-logs", label: "Send Logs", icon: Mail },
			{ href: "/webhook-logs", label: "Webhook Logs", icon: ScrollText },
		],
	},
];

export function AppSidebar({
	resizable = true,
	onDismiss,
}: {
	resizable?: boolean;
	onDismiss?: () => void;
}) {
	const { pathname } = useLocation();
	const { user } = useAuth();
	const [profile, setProfile] = useState<{ name: string | null; avatar: string | null }>({
		name: null,
		avatar: null,
	});

	useEffect(() => {
		let cancelled = false;
		fetch("/api/auth/profile")
			.then((res) => (res.ok ? res.json() : { name: null, avatar: null }))
			.then((data: unknown) => {
				if (cancelled) return;
				if (typeof data !== "object" || data === null) {
					setProfile({ name: null, avatar: null });
					return;
				}
				const record = data as Record<string, unknown>;
				setProfile({
					name: typeof record.name === "string" ? record.name : null,
					avatar: typeof record.avatar === "string" ? record.avatar : null,
				});
			})
			.catch(() => {
				if (!cancelled) setProfile({ name: null, avatar: null });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const userName = profile.name ?? user?.name ?? "User";
	const userEmail = user?.email ?? "";
	const avatar = (
		<Avatar>
			{profile.avatar && <AvatarImage src={profile.avatar} alt={userName} />}
			<AvatarFallback>{userName[0] ?? "?"}</AvatarFallback>
		</Avatar>
	);

	return (
		<Sidebar resizable={resizable}>
			<SidebarHeader>
				<SidebarBrand
					logo={<img src="/logo-24.png" alt="" />}
					name="dove"
					version={`v${APP_VERSION}`}
					action={
						onDismiss ? <SidebarToggle mode="dismiss" onDismiss={onDismiss} /> : <SidebarToggle />
					}
				/>
			</SidebarHeader>
			<SidebarNav aria-label="Workspace navigation">
				{navGroups.map((group) => (
					<SidebarGroup key={group.label} label={group.label}>
						{group.items.map((item) => {
							const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
							return (
								<SidebarItem key={item.href} href={item.href} active={active}>
									<item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
									<span className="flex-1 truncate text-left">{item.label}</span>
								</SidebarItem>
							);
						})}
					</SidebarGroup>
				))}
			</SidebarNav>
			<SidebarFooter>
				<SidebarUser
					name={userName}
					email={userEmail}
					avatar={avatar}
					onSignOut={() => void signOut()}
				/>
			</SidebarFooter>
		</Sidebar>
	);
}
