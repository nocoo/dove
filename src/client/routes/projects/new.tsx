import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderOption {
  id: string;
  name: string;
  type: "resend" | "cloudflare";
  domain: string;
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emailPrefix, setEmailPrefix] = useState("");
  const [fromName, setFromName] = useState("");
  const [quotaDaily, setQuotaDaily] = useState("100");
  const [quotaMonthly, setQuotaMonthly] = useState("1000");
  const [providerId, setProviderId] = useState<string>("");
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/providers");
        if (!res.ok) return;
        setProviders((await res.json()) as ProviderOption[]);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      setSaving(true);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          email_prefix: emailPrefix.trim(),
          from_name: fromName.trim(),
          quota_daily: parseInt(quotaDaily, 10) || 100,
          quota_monthly: parseInt(quotaMonthly, 10) || 1000,
          ...(providerId !== "" ? { provider_id: providerId } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to create project");
      }

      const project = await res.json() as { id: string; webhook_token: string };
      toast.success("Project created! Webhook token has been generated.");
      void navigate(`/projects/${project.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = name.trim() && emailPrefix.trim() && fromName.trim() && !saving;

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold font-display">New Project</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create an email relay project. A webhook token will be generated automatically.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My App"
            maxLength={100}
            autoFocus
            disabled={saving}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this project"
            maxLength={500}
            rows={3}
            disabled={saving}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email_prefix">Email Prefix</Label>
          <div className="flex items-center gap-2">
            <Input
              id="email_prefix"
              value={emailPrefix}
              onChange={(e) => setEmailPrefix(e.target.value)}
              placeholder="noreply"
              maxLength={64}
              disabled={saving}
            />
            <span className="text-sm text-muted-foreground shrink-0">@your-domain.com</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The local part of the sender email address.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="from_name">Sender Display Name</Label>
          <Input
            id="from_name"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="My App"
            maxLength={128}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Shown as the &quot;From&quot; name in the recipient&apos;s inbox.
          </p>
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
              disabled={saving}
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
              disabled={saving}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="provider_id">Email Provider</Label>
          <Select
            value={providerId === "" ? "__legacy__" : providerId}
            onValueChange={(v) =>
              setProviderId(v === "__legacy__" ? "" : v)
            }
            disabled={saving}
          >
            <SelectTrigger id="provider_id">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__legacy__">
                Legacy (RESEND_API_KEY env)
              </SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {p.type} · {p.domain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Choose a configured provider, or stay on Legacy to use the
            existing RESEND_API_KEY env-var fallback.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={!canSubmit}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Create Project
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
