import { Button, Input, Label, LayerCard, toast } from "@nocoo/basalt";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nocoo/basalt/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { Loader2, Trash2 } from "@nocoo/basalt/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { cn } from "@/lib/utils";

type ProviderType = "resend" | "cloudflare";

interface SanitizedProvider {
	id: string;
	name: string;
	type: ProviderType;
	domain: string;
	config: Record<string, string>;
	created_at: string;
	updated_at: string;
}

export function ProviderDetailPage() {
	const { id: providerId } = useParams<"id">();
	const navigate = useNavigate();

	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [record, setRecord] = useState<SanitizedProvider | null>(null);

	const [name, setName] = useState("");
	const [type, setType] = useState<ProviderType>("resend");
	const [domain, setDomain] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [apiKeyChanged, setApiKeyChanged] = useState(false);

	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const fetchRecord = useCallback(async () => {
		if (!providerId) return;
		try {
			setLoading(true);
			setLoadError(null);
			const res = await fetch(`/api/providers/${providerId}`);
			if (!res.ok) throw new Error("Failed to load provider");
			const data = (await res.json()) as SanitizedProvider;
			setRecord(data);
			setName(data.name);
			setType(data.type);
			setDomain(data.domain);
			setApiKey("");
			setApiKeyChanged(false);
		} catch {
			setLoadError("Failed to load provider");
		} finally {
			setLoading(false);
		}
	}, [providerId]);

	useEffect(() => {
		void fetchRecord();
	}, [fetchRecord]);

	const dirty = useMemo(() => {
		if (!record) return false;
		if (name !== record.name) return true;
		if (type !== record.type) return true;
		if (domain !== record.domain) return true;
		if (apiKeyChanged) return true;
		return false;
	}, [record, name, type, domain, apiKeyChanged]);

	const canSubmit = !!name.trim() && !!domain.trim() && dirty && !saving;

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		if (!record || !providerId) return;
		setError(null);

		const typeChanged = type !== record.type;
		const configTouched = apiKeyChanged || typeChanged;

		const payload: Record<string, unknown> = {};
		if (name !== record.name) payload.name = name.trim();
		if (domain !== record.domain) payload.domain = domain.trim();
		if (typeChanged) payload.type = type;

		if (configTouched && type === "resend") {
			if (!apiKeyChanged) {
				setError("Re-enter the API key to change the provider config.");
				return;
			}
			const cfg: Record<string, string> = type === "resend" ? { api_key: apiKey.trim() } : {};
			payload.config = cfg;
		} else if (configTouched && type === "cloudflare") {
			payload.config = {};
		}

		try {
			setSaving(true);
			const res = await fetch(`/api/providers/${providerId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Failed to save");
			}
			toast.success("Saved");
			await fetchRecord();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to save";
			setError(message);
			toast.danger(message);
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!providerId) return;
		try {
			setDeleting(true);
			const res = await fetch(`/api/providers/${providerId}`, {
				method: "DELETE",
			});
			if (res.status === 409) {
				const data = (await res.json()) as {
					error: { message: string };
				};
				toast.danger(data.error.message);
				return;
			}
			if (!res.ok) throw new Error("Delete failed");
			toast.success("Provider deleted");
			void navigate("/providers");
		} catch {
			toast.danger("Failed to delete provider");
		} finally {
			setDeleting(false);
			setConfirmOpen(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-5 w-5 animate-spin text-basalt-muted-foreground" />
			</div>
		);
	}

	if (loadError || !record) {
		return (
			<div className="rounded-lg border border-basalt-destructive/30 bg-basalt-destructive/5 p-6 text-center">
				<p className="text-basalt-sm text-basalt-destructive">
					{loadError ?? "Provider not found"}
				</p>
				<Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchRecord()}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-col gap-6 max-w-2xl">
				<div>
					<h1 className="text-basalt-xl md:text-basalt-3xl font-semibold">{record.name}</h1>
					<p className="text-basalt-sm text-basalt-muted-foreground mt-1">
						Update credentials or rotate the provider type.
					</p>
				</div>

				<LayerCard>
					<LayerCard.Header>
						<h3>Settings</h3>
						<p>The API key is masked; retype it to change it.</p>
					</LayerCard.Header>
					<LayerCard.Body>
						<form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-5">
							<div className="flex flex-col gap-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									maxLength={100}
									disabled={saving}
								/>
							</div>

							<div className="flex flex-col gap-2">
								<Label htmlFor="type">Type</Label>
								<Select
									value={type}
									onValueChange={(v: string) => setType(v as ProviderType)}
									disabled={saving}
								>
									<SelectTrigger id="type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="resend">Resend</SelectItem>
										<SelectItem value="cloudflare">Cloudflare Email</SelectItem>
									</SelectContent>
								</Select>
								{type !== record.type && (
									<p className="text-basalt-xs text-basalt-warning dark:text-basalt-warning">
										Type change: retype the API key before saving.
									</p>
								)}
							</div>

							<div className="flex flex-col gap-2">
								<Label htmlFor="domain">Sending Domain</Label>
								<Input
									id="domain"
									value={domain}
									onChange={(e) => setDomain(e.target.value)}
									maxLength={253}
									disabled={saving}
								/>
							</div>

							{type === "resend" && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="api_key">API Key</Label>
									<Input
										id="api_key"
										type="password"
										value={apiKey}
										onChange={(e) => {
											setApiKey(e.target.value);
											setApiKeyChanged(true);
										}}
										disabled={saving}
										placeholder={
											apiKeyChanged ? "" : `Current: ${record.config.api_key ?? "(unset)"}`
										}
									/>
									<p className="text-basalt-xs text-basalt-muted-foreground">
										{apiKeyChanged
											? "New key staged — will replace the stored secret on save."
											: "Leave blank to keep the current secret. Type a new key to replace it."}
									</p>
								</div>
							)}

							{type === "cloudflare" && (
								<p className="text-basalt-sm text-basalt-muted-foreground">
									Cloudflare Email Routing uses the Worker email binding — no API key needed.
								</p>
							)}

							{error && <p className="text-basalt-sm text-basalt-destructive">{error}</p>}

							<div className="flex items-center gap-3 pt-1">
								<Button type="submit" disabled={!canSubmit}>
									{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
									Save changes
								</Button>
								<span
									className={cn(
										"text-basalt-xs",
										dirty ? "text-basalt-warning" : "text-basalt-muted-foreground",
									)}
								>
									{dirty ? "Unsaved changes" : "Up to date"}
								</span>
							</div>
						</form>
					</LayerCard.Body>
				</LayerCard>

				<LayerCard className="border-basalt-destructive/40">
					<LayerCard.Header>
						<h3>Danger Zone</h3>
						<p>Deleting a provider is blocked while any project still references it.</p>
					</LayerCard.Header>
					<LayerCard.Body>
						<Button
							variant="outline"
							onClick={() => setConfirmOpen(true)}
							disabled={deleting}
							className="text-basalt-destructive hover:text-basalt-destructive"
						>
							<Trash2 className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
							Delete Provider
						</Button>
					</LayerCard.Body>
				</LayerCard>
			</div>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {record.name}?</DialogTitle>
						<DialogDescription>
							This removes the provider configuration. Projects that reference it must be reassigned
							first; otherwise the request is rejected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
							{deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
