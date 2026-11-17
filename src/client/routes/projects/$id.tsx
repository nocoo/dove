import { Button, Input, Label, LayerCard, Switch, toast } from "@nocoo/basalt";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@nocoo/basalt/components/dialog";
import { InputArea } from "@nocoo/basalt/components/input-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	Copy,
	Eye,
	EyeOff,
	FileText,
	Globe,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	Users,
} from "@nocoo/basalt/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ProjectDetailSkeleton } from "@/components/skeletons";

interface Project {
	id: string;
	name: string;
	description: string | null;
	email_prefix: string;
	from_name: string;
	quota_daily: number;
	quota_monthly: number;
	provider_id: string | null;
	allow_unknown_recipients: boolean;
	created_at: string;
	updated_at: string;
}

interface ProviderOption {
	id: string;
	name: string;
	type: "resend" | "cloudflare";
	domain: string;
}

interface Recipient {
	id: string;
	project_id: string;
	name: string;
	email: string;
	created_at: string;
}

interface Template {
	id: string;
	project_id: string;
	slug: string;
	name: string;
	subject: string;
	created_at: string;
}

export function ProjectDetailPage() {
	const navigate = useNavigate();
	const { id: projectId } = useParams<"id">();
	const [project, setProject] = useState<Project | null>(null);
	const [recipients, setRecipients] = useState<Recipient[]>([]);
	const [templates, setTemplates] = useState<Template[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// Form state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [emailPrefix, setEmailPrefix] = useState("");
	const [fromName, setFromName] = useState("");
	const [quotaDaily, setQuotaDaily] = useState("");
	const [quotaMonthly, setQuotaMonthly] = useState("");

	// Provider selector
	const [providerId, setProviderId] = useState<string>("");
	const [providers, setProviders] = useState<ProviderOption[]>([]);

	// Token state
	const [token, setToken] = useState<string | null>(null);
	const [tokenVisible, setTokenVisible] = useState(false);
	const [regenerating, setRegenerating] = useState(false);

	// Recipient form
	const [showAddRecipient, setShowAddRecipient] = useState(false);
	const [newRecipientName, setNewRecipientName] = useState("");
	const [newRecipientEmail, setNewRecipientEmail] = useState("");
	const [addingRecipient, setAddingRecipient] = useState(false);

	// Delete state
	const [deleting, setDeleting] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingRecipientId, setDeletingRecipientId] = useState<string | null>(null);
	const [recipientToDelete, setRecipientToDelete] = useState<Recipient | null>(null);

	// Recipient mode toggle
	const [allowUnknown, setAllowUnknown] = useState(false);
	const [togglingMode, setTogglingMode] = useState(false);

	const fetchData = useCallback(async () => {
		if (!projectId) return;
		try {
			setLoading(true);
			setError(null);
			const [projectRes, recipientsRes, templatesRes] = await Promise.all([
				fetch(`/api/projects/${projectId}`),
				fetch(`/api/recipients?projectId=${projectId}`),
				fetch(`/api/templates?projectId=${projectId}`),
			]);

			if (!projectRes.ok) throw new Error("Project not found");

			const proj = (await projectRes.json()) as Project;
			setProject(proj);
			setName(proj.name);
			setDescription(proj.description ?? "");
			setEmailPrefix(proj.email_prefix);
			setFromName(proj.from_name);
			setQuotaDaily(String(proj.quota_daily));
			setQuotaMonthly(String(proj.quota_monthly));
			setProviderId(proj.provider_id ?? "");
			setAllowUnknown(proj.allow_unknown_recipients ?? false);

			if (recipientsRes.ok) setRecipients((await recipientsRes.json()) as Recipient[]);
			if (templatesRes.ok) setTemplates((await templatesRes.json()) as Template[]);
		} catch {
			setError("Failed to load project");
			toast.error("Failed to load project");
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/providers");
				if (!res.ok) return;
				const list = (await res.json()) as ProviderOption[];
				setProviders(list);
			} catch {
				// Non-fatal
			}
		})();
	}, []);

	const dirty = useMemo(() => {
		if (!project) return false;
		return (
			name !== project.name ||
			description !== (project.description ?? "") ||
			emailPrefix !== project.email_prefix ||
			fromName !== project.from_name ||
			quotaDaily !== String(project.quota_daily) ||
			quotaMonthly !== String(project.quota_monthly) ||
			providerId !== (project.provider_id ?? "")
		);
	}, [project, name, description, emailPrefix, fromName, quotaDaily, quotaMonthly, providerId]);

	async function handleSave() {
		if (!projectId) return;
		try {
			setSaving(true);
			const res = await fetch(`/api/projects/${projectId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: name.trim(),
					description: description.trim() || null,
					email_prefix: emailPrefix.trim(),
					from_name: fromName.trim(),
					quota_daily: parseInt(quotaDaily, 10) || 100,
					quota_monthly: parseInt(quotaMonthly, 10) || 1000,
					provider_id: providerId === "" ? null : providerId,
				}),
			});

			if (!res.ok) throw new Error("Failed to save");
			const updated = (await res.json()) as Project;
			setProject(updated);
			toast.success("Project saved");
		} catch {
			toast.error("Failed to save project");
		} finally {
			setSaving(false);
		}
	}

	function resetForm() {
		if (!project) return;
		setName(project.name);
		setDescription(project.description ?? "");
		setEmailPrefix(project.email_prefix);
		setFromName(project.from_name);
		setQuotaDaily(String(project.quota_daily));
		setQuotaMonthly(String(project.quota_monthly));
		setProviderId(project.provider_id ?? "");
	}

	async function handleToggleRecipientMode(checked: boolean) {
		if (!projectId) return;
		const previous = allowUnknown;
		try {
			setTogglingMode(true);
			setAllowUnknown(checked);
			const res = await fetch(`/api/projects/${projectId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ allow_unknown_recipients: checked }),
			});
			if (!res.ok) throw new Error("Failed to update recipient mode");
			const updated = (await res.json()) as Project;
			setProject(updated);
			toast.success(checked ? "Any email address accepted" : "Whitelist mode enabled");
		} catch {
			setAllowUnknown(previous);
			toast.error("Failed to update recipient mode");
		} finally {
			setTogglingMode(false);
		}
	}

	async function handleRegenerateToken() {
		if (!projectId) return;
		try {
			setRegenerating(true);
			const res = await fetch(`/api/projects/${projectId}/token`, { method: "POST" });
			if (!res.ok) throw new Error("Failed to regenerate token");
			const data = (await res.json()) as { webhook_token: string };
			setToken(data.webhook_token);
			setTokenVisible(true);
			toast.success("Token regenerated. Copy it now — it won't be shown again.");
		} catch {
			toast.error("Failed to regenerate token");
		} finally {
			setRegenerating(false);
		}
	}

	async function handleAddRecipient(e: React.FormEvent) {
		e.preventDefault();
		if (!projectId) return;
		try {
			setAddingRecipient(true);
			const res = await fetch("/api/recipients", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					project_id: projectId,
					name: newRecipientName.trim(),
					email: newRecipientEmail.trim(),
				}),
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Failed to add recipient");
			}

			const recipient = (await res.json()) as Recipient;
			setRecipients((prev) => [...prev, recipient]);
			setNewRecipientName("");
			setNewRecipientEmail("");
			setShowAddRecipient(false);
			toast.success("Recipient added");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to add recipient");
		} finally {
			setAddingRecipient(false);
		}
	}

	async function handleDeleteRecipient(recipientId: string) {
		try {
			setDeletingRecipientId(recipientId);
			const res = await fetch(`/api/recipients/${recipientId}`, { method: "DELETE" });
			if (!res.ok) throw new Error("Failed to delete recipient");
			setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
			toast.success("Recipient removed");
		} catch {
			toast.error("Failed to delete recipient");
		} finally {
			setDeletingRecipientId(null);
			setRecipientToDelete(null);
		}
	}

	async function handleDeleteProject() {
		if (!projectId) return;
		try {
			setDeleting(true);
			const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
			if (!res.ok) throw new Error("Failed to delete");
			toast.success("Project deleted");
			void navigate("/projects");
		} catch {
			toast.error("Failed to delete project");
		} finally {
			setDeleting(false);
			setDeleteDialogOpen(false);
		}
	}

	if (loading) {
		return <ProjectDetailSkeleton />;
	}

	if (error && !project) {
		return (
			<div className="rounded-lg border border-basalt-destructive/30 bg-basalt-destructive/5 p-6 text-center">
				<p className="text-basalt-sm text-basalt-destructive">{error}</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-3"
					onClick={() => void navigate("/projects")}
				>
					Back to Projects
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 max-w-2xl">
			{/* Unsaved changes bar */}
			{dirty && (
				<div className="flex items-center gap-3 rounded-lg border border-basalt-primary/20 bg-basalt-primary/5 px-4 py-3">
					<p className="text-basalt-sm text-basalt-muted-foreground flex-1">
						You have unsaved changes.
					</p>
					<Button size="sm" variant="outline" onClick={resetForm}>
						Reset
					</Button>
					<Button size="sm" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
						{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
						Save Changes
					</Button>
				</div>
			)}

			{/* Settings card */}
			<LayerCard>
				<LayerCard.Header>
					<h3 className="text-basalt-base">Settings</h3>
					<p>Project configuration and sender details.</p>
				</LayerCard.Header>
				<LayerCard.Body className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="description">
							Description{" "}
							<span className="text-basalt-muted-foreground font-normal">(optional)</span>
						</Label>
						<InputArea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							maxLength={500}
							rows={2}
						/>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="email_prefix">Email Prefix</Label>
							<Input
								id="email_prefix"
								value={emailPrefix}
								onChange={(e) => setEmailPrefix(e.target.value)}
								maxLength={64}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="from_name">From Name</Label>
							<Input
								id="from_name"
								value={fromName}
								onChange={(e) => setFromName(e.target.value)}
								maxLength={128}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="quota_daily">Daily Quota</Label>
							<Input
								id="quota_daily"
								type="number"
								value={quotaDaily}
								onChange={(e) => setQuotaDaily(e.target.value)}
								min={1}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="quota_monthly">Monthly Quota</Label>
							<Input
								id="quota_monthly"
								type="number"
								value={quotaMonthly}
								onChange={(e) => setQuotaMonthly(e.target.value)}
								min={1}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="provider_id">Email Provider</Label>
						<Select
							value={providerId === "" ? "__legacy__" : providerId}
							onValueChange={(v: string) => setProviderId(v === "__legacy__" ? "" : v)}
						>
							<SelectTrigger id="provider_id">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__legacy__">Legacy (RESEND_API_KEY env)</SelectItem>
								{providers.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.name} — {p.type} · {p.domain}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-basalt-xs text-basalt-muted-foreground">
							Picks the outbound backend. Legacy uses the RESEND_API_KEY / RESEND_FROM_DOMAIN env
							vars for backward compat.
						</p>
					</div>
				</LayerCard.Body>
			</LayerCard>

			{/* Webhook token card */}
			<LayerCard>
				<LayerCard.Header>
					<h3 className="text-basalt-base">Webhook Token</h3>
					<p>Use this token as a Bearer token to authenticate webhook requests.</p>
				</LayerCard.Header>
				<LayerCard.Body className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<Label className="text-basalt-xs text-basalt-muted-foreground">Webhook URL</Label>
						<div className="flex items-center gap-2">
							<div className="flex-1 rounded-md border border-basalt-border bg-basalt-muted/30 px-3 py-2 font-mono text-basalt-xs break-all">
								{`${window.location.origin}/api/webhook/${projectId ?? ""}/send`}
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									void navigator.clipboard
										.writeText(`${window.location.origin}/api/webhook/${projectId ?? ""}/send`)
										.then(() => toast.success("Webhook URL copied"))
										.catch(() => toast.error("Failed to copy URL"));
								}}
							>
								<Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<Label className="text-basalt-xs text-basalt-muted-foreground">Project ID</Label>
						<div className="flex items-center gap-2">
							<div className="flex-1 rounded-md border border-basalt-border bg-basalt-muted/30 px-3 py-2 font-mono text-basalt-xs break-all">
								{projectId}
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									if (!projectId) return;
									void navigator.clipboard
										.writeText(projectId)
										.then(() => toast.success("Project ID copied"))
										.catch(() => toast.error("Failed to copy ID"));
								}}
							>
								<Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<Label className="text-basalt-xs text-basalt-muted-foreground">Token</Label>
						{token ? (
							<div className="flex items-center gap-2">
								<div className="flex-1 rounded-md border border-basalt-border bg-basalt-muted/30 px-3 py-2 font-mono text-basalt-xs break-all">
									{tokenVisible ? token : "••••••••••••••••••••••••••••••••••••••••••••••••"}
								</div>
								<Button variant="outline" size="sm" onClick={() => setTokenVisible(!tokenVisible)}>
									{tokenVisible ? (
										<EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
									) : (
										<Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
									)}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										void navigator.clipboard
											.writeText(token)
											.then(() => toast.success("Token copied to clipboard"))
											.catch(() => toast.error("Failed to copy token"));
									}}
								>
									<Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
								</Button>
							</div>
						) : (
							<p className="text-basalt-xs text-basalt-muted-foreground">
								Token is hidden for security. Regenerate to get a new one.
							</p>
						)}
					</div>

					<Button
						variant="outline"
						size="sm"
						className="w-fit"
						onClick={() => void handleRegenerateToken()}
						disabled={regenerating}
					>
						{regenerating ? (
							<Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
						) : (
							<RefreshCw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
						)}
						Regenerate Token
					</Button>
				</LayerCard.Body>
			</LayerCard>

			{/* Recipients card */}
			<LayerCard>
				<LayerCard.Header>
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-basalt-base">Recipients</h3>
							<p>Control who can receive emails from this project.</p>
						</div>
						{!allowUnknown && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowAddRecipient(!showAddRecipient)}
							>
								<Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
								Add
							</Button>
						)}
					</div>
				</LayerCard.Header>
				<LayerCard.Body className="flex flex-col gap-3">
					{/* Recipient mode toggle */}
					<div className="flex items-center justify-between rounded-lg border border-basalt-border bg-basalt-muted/20 px-4 py-3">
						<div className="flex items-center gap-3">
							<Globe className="h-4 w-4 text-basalt-muted-foreground" strokeWidth={1.5} />
							<div>
								<p className="text-basalt-sm font-medium">Accept any email address</p>
								<p className="text-basalt-xs text-basalt-muted-foreground">
									{allowUnknown
										? "Sends skip the whitelist. Rate limits and quotas still apply."
										: "Only whitelisted recipients can receive emails."}
								</p>
							</div>
						</div>
						<Switch
							checked={allowUnknown}
							onCheckedChange={(checked: boolean) => void handleToggleRecipientMode(checked)}
							disabled={togglingMode}
						/>
					</div>

					{allowUnknown && (
						<p className="text-basalt-xs text-basalt-muted-foreground italic">
							Your existing whitelist is preserved and will re-activate if you turn this off.
						</p>
					)}

					{!allowUnknown && (
						<>
							{showAddRecipient && (
								<form
									onSubmit={(e) => void handleAddRecipient(e)}
									className="flex flex-col gap-3 rounded-basalt-md bg-basalt-muted/20 p-3"
								>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
										<Input
											placeholder="Name"
											value={newRecipientName}
											onChange={(e) => setNewRecipientName(e.target.value)}
											disabled={addingRecipient}
										/>
										<Input
											type="email"
											placeholder="email@example.com"
											value={newRecipientEmail}
											onChange={(e) => setNewRecipientEmail(e.target.value)}
											disabled={addingRecipient}
										/>
									</div>
									<div className="flex items-center gap-2">
										<Button
											type="submit"
											size="sm"
											disabled={
												!newRecipientName.trim() || !newRecipientEmail.trim() || addingRecipient
											}
										>
											{addingRecipient && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
											Add Recipient
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => setShowAddRecipient(false)}
										>
											Cancel
										</Button>
									</div>
								</form>
							)}

							{recipients.length === 0 ? (
								<div className="rounded-basalt-lg bg-basalt-secondary p-6 text-center">
									<Users
										className="h-8 w-8 text-basalt-muted-foreground/40 mx-auto mb-2"
										strokeWidth={1.5}
									/>
									<p className="text-basalt-xs text-basalt-muted-foreground">
										No recipients yet. Add one to start sending emails.
									</p>
								</div>
							) : (
								<div className="rounded-basalt-lg bg-basalt-secondary p-1 overflow-x-auto">
									{recipients.map((r) => (
										<div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
											<div className="min-w-0 flex-1">
												<p className="text-basalt-sm font-medium text-basalt-foreground truncate">
													{r.name}
												</p>
												<p className="text-basalt-xs text-basalt-muted-foreground truncate">
													{r.email}
												</p>
											</div>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setRecipientToDelete(r)}
												disabled={deletingRecipientId === r.id}
												className="text-basalt-muted-foreground hover:text-basalt-destructive"
											>
												{deletingRecipientId === r.id ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
												) : (
													<Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
												)}
											</Button>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</LayerCard.Body>
			</LayerCard>

			{/* Templates card */}
			<LayerCard>
				<LayerCard.Header>
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-basalt-base">Templates</h3>
							<p>Email templates for this project ({templates.length}).</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void navigate(`/templates/new?projectId=${projectId}`)}
						>
							<Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
							Add
						</Button>
					</div>
				</LayerCard.Header>
				<LayerCard.Body>
					{templates.length === 0 ? (
						<div className="rounded-basalt-lg bg-basalt-secondary p-6 text-center">
							<FileText
								className="h-8 w-8 text-basalt-muted-foreground/40 mx-auto mb-2"
								strokeWidth={1.5}
							/>
							<p className="text-basalt-xs text-basalt-muted-foreground">No templates yet.</p>
						</div>
					) : (
						<div className="rounded-basalt-lg bg-basalt-secondary p-1 overflow-x-auto">
							{templates.map((t) => (
								<Link
									key={t.id}
									to={`/templates/${t.id}`}
									className="flex items-center gap-3 px-3 py-2.5 hover:bg-basalt-hover/30 transition-colors"
								>
									<div className="min-w-0 flex-1">
										<p className="text-basalt-sm font-medium text-basalt-foreground truncate">
											{t.name}
										</p>
										<p className="text-basalt-xs text-basalt-muted-foreground truncate">
											<span className="font-mono">{t.slug}</span>
											<span className="mx-1.5 text-basalt-border">·</span>
											<span>{t.subject}</span>
										</p>
									</div>
								</Link>
							))}
						</div>
					)}
				</LayerCard.Body>
			</LayerCard>

			{/* Danger zone */}
			<LayerCard className="ring-1 ring-basalt-destructive/30">
				<LayerCard.Header>
					<h3 className="text-basalt-base text-basalt-destructive">Danger Zone</h3>
					<p>Permanently delete this project and all associated data.</p>
				</LayerCard.Header>
				<LayerCard.Body>
					<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
						<DialogTrigger asChild>
							<Button variant="destructive" size="sm">
								<Trash2 className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
								Delete Project
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Delete Project?</DialogTitle>
								<DialogDescription>
									This will permanently delete <strong>{project?.name}</strong> and all its
									recipients, templates, and send logs. This action cannot be undone.
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => setDeleteDialogOpen(false)}
									disabled={deleting}
								>
									Cancel
								</Button>
								<Button
									variant="destructive"
									onClick={() => void handleDeleteProject()}
									disabled={deleting}
								>
									{deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
									Delete
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</LayerCard.Body>
			</LayerCard>

			{/* Recipient delete confirmation */}
			<Dialog
				open={recipientToDelete !== null}
				onOpenChange={(open: boolean) => {
					if (!open) setRecipientToDelete(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove Recipient?</DialogTitle>
						<DialogDescription>
							This will remove <strong>{recipientToDelete?.name}</strong> (
							{recipientToDelete?.email}) from this project's whitelist. Future sends to this
							address will be rejected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setRecipientToDelete(null)}
							disabled={deletingRecipientId !== null}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (recipientToDelete) void handleDeleteRecipient(recipientToDelete.id);
							}}
							disabled={deletingRecipientId !== null}
						>
							{deletingRecipientId !== null && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
