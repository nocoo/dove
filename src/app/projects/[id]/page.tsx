"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Copy,
  RefreshCw,
  Plus,
  Trash2,
  FileText,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Project {
  id: string;
  name: string;
  description: string | null;
  email_prefix: string;
  from_name: string;
  quota_daily: number;
  quota_monthly: number;
  created_at: string;
  updated_at: string;
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

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(null);
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

  useEffect(() => {
    void params.then((p) => setProjectId(p.id));
  }, [params]);

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

      const proj = await projectRes.json() as Project;
      setProject(proj);
      setName(proj.name);
      setDescription(proj.description ?? "");
      setEmailPrefix(proj.email_prefix);
      setFromName(proj.from_name);
      setQuotaDaily(String(proj.quota_daily));
      setQuotaMonthly(String(proj.quota_monthly));

      if (recipientsRes.ok) setRecipients(await recipientsRes.json() as Recipient[]);
      if (templatesRes.ok) setTemplates(await templatesRes.json() as Template[]);
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

  // Dirty tracking
  const dirty = useMemo(() => {
    if (!project) return false;
    return (
      name !== project.name ||
      description !== (project.description ?? "") ||
      emailPrefix !== project.email_prefix ||
      fromName !== project.from_name ||
      quotaDaily !== String(project.quota_daily) ||
      quotaMonthly !== String(project.quota_monthly)
    );
  }, [project, name, description, emailPrefix, fromName, quotaDaily, quotaMonthly]);

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
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json() as Project;
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
  }

  async function handleRegenerateToken() {
    if (!projectId) return;
    try {
      setRegenerating(true);
      const res = await fetch(`/api/projects/${projectId}/token`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to regenerate token");
      const data = await res.json() as { webhook_token: string };
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
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to add recipient");
      }

      const recipient = await res.json() as Recipient;
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
    }
  }

  async function handleDeleteProject() {
    if (!projectId) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Project deleted");
      router.push("/projects");
    } catch {
      toast.error("Failed to delete project");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "..." }]}>
        <ProjectDetailSkeleton />
      </AppShell>
    );
  }

  if (error && !project) {
    return (
      <AppShell breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "Error" }]}>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push("/projects")}>
            Back to Projects
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project?.name ?? "..." }]}>
      <div className="flex flex-col gap-6 max-w-2xl">
        {/* Unsaved changes bar */}
        {dirty && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm text-muted-foreground flex-1">You have unsaved changes.</p>
            <Button size="sm" variant="outline" onClick={resetForm}>Reset</Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save Changes
            </Button>
          </div>
        )}

        {/* Settings card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
            <CardDescription>Project configuration and sender details.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="description">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
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
          </CardContent>
        </Card>

        {/* Webhook token card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook Token</CardTitle>
            <CardDescription>
              Use this token as a Bearer token to authenticate webhook requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {token ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs break-all">
                  {tokenVisible ? token : "••••••••••••••••••••••••••••••••••••••••••••••••"}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTokenVisible(!tokenVisible)}
                >
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
                    void navigator.clipboard.writeText(token);
                    toast.success("Token copied to clipboard");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Token is hidden for security. Regenerate to get a new one.
              </p>
            )}
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
          </CardContent>
        </Card>

        {/* Recipients card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Recipients</CardTitle>
                <CardDescription>
                  Allowed email addresses for this project ({recipients.length}).
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddRecipient(!showAddRecipient)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {showAddRecipient && (
              <form
                onSubmit={(e) => void handleAddRecipient(e)}
                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3"
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
                    disabled={!newRecipientName.trim() || !newRecipientEmail.trim() || addingRecipient}
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
              <div className="rounded-lg border border-border bg-background/50 p-6 text-center">
                <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-muted-foreground">No recipients yet. Add one to start sending emails.</p>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {recipients.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteRecipient(r.id)}
                      disabled={deletingRecipientId === r.id}
                      className="text-muted-foreground hover:text-destructive"
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
          </CardContent>
        </Card>

        {/* Templates card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Templates</CardTitle>
                <CardDescription>
                  Email templates for this project ({templates.length}).
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/templates/new?projectId=${projectId}`)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <div className="rounded-lg border border-border bg-background/50 p-6 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-muted-foreground">No templates yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {templates.map((t) => (
                  <Link
                    key={t.id}
                    href={`/templates/${t.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="font-mono">{t.slug}</span>
                        <span className="mx-1.5 text-border">·</span>
                        <span>{t.subject}</span>
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="ring-1 ring-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently delete this project and all associated data.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
