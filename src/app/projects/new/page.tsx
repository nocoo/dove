"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function NewProjectPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emailPrefix, setEmailPrefix] = useState("");
  const [fromName, setFromName] = useState("");
  const [quotaDaily, setQuotaDaily] = useState("100");
  const [quotaMonthly, setQuotaMonthly] = useState("1000");

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
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to create project");
      }

      const project = await res.json() as { id: string; webhook_token: string };
      toast.success("Project created! Webhook token has been generated.");
      router.push(`/projects/${project.id}`);
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
    <AppShell breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "New" }]}>
      <div className="flex flex-col gap-6 max-w-lg">
        <div>
          <h1 className="text-xl font-semibold font-display">New Project</h1>
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={!canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create Project
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
