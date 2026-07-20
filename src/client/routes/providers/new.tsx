import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type ProviderType = "resend" | "cloudflare";

export function NewProviderPage() {
	const navigate = useNavigate();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [name, setName] = useState("");
	const [type, setType] = useState<ProviderType>("resend");
	const [domain, setDomain] = useState("");
	const [apiKey, setApiKey] = useState("");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);

		const config: Record<string, string> = type === "resend" ? { api_key: apiKey.trim() } : {};

		try {
			setSaving(true);
			const res = await fetch("/api/providers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: name.trim(),
					type,
					domain: domain.trim(),
					config,
				}),
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Failed to create provider");
			}

			const provider = (await res.json()) as { id: string };
			toast.success("Provider created");
			void navigate(`/providers/${provider.id}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to create provider";
			setError(message);
			toast.error(message);
		} finally {
			setSaving(false);
		}
	}

	const canSubmit =
		name.trim() && domain.trim() && (type === "cloudflare" || apiKey.trim()) && !saving;

	return (
		<div className="flex flex-col gap-6 max-w-lg">
			<div>
				<h1 className="text-xl md:text-2xl font-semibold font-display">New Provider</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Register an email backend. The config is validated against the type&apos;s schema before
					it&apos;s saved.
				</p>
			</div>

			<form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Production Resend"
						maxLength={100}
						autoFocus
						disabled={saving}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="type">Type</Label>
					<Select value={type} onValueChange={(v) => setType(v as ProviderType)} disabled={saving}>
						<SelectTrigger id="type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="resend">Resend</SelectItem>
							<SelectItem value="cloudflare">Cloudflare Email</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="domain">Sending Domain</Label>
					<Input
						id="domain"
						value={domain}
						onChange={(e) => setDomain(e.target.value)}
						placeholder="mail.example.com"
						maxLength={253}
						disabled={saving}
					/>
					<p className="text-xs text-muted-foreground">
						Verified sender domain. Normalized to lowercase before storage.
					</p>
				</div>

				{type === "resend" && (
					<div className="flex flex-col gap-2">
						<Label htmlFor="api_key">API Key</Label>
						<Input
							id="api_key"
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="re_xxxxxxxxxxxx"
							disabled={saving}
						/>
					</div>
				)}

				{type === "cloudflare" && (
					<p className="text-sm text-muted-foreground">
						Cloudflare Email Routing uses the Worker email binding — no API key needed.
					</p>
				)}

				{error && <p className="text-sm text-destructive">{error}</p>}

				<div className="flex items-center gap-3 pt-1">
					<Button type="submit" disabled={!canSubmit}>
						{saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
						Create Provider
					</Button>
					<Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={saving}>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	);
}
