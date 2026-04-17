"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export default function ProviderEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: providerId } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [record, setRecord] = useState<SanitizedProvider | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("resend");
  const [domain, setDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [workerUrl, setWorkerUrl] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const { data: session } = useSession();

  const fetchRecord = useCallback(async () => {
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
      // Never bind the masked placeholder to the input value — typing would
      // append to "••••••abcd" and submit garbage. Keep the input empty
      // until the user explicitly types a replacement; the display-only
      // "last4" hint lives in the helper text below.
      setApiKey("");
      setApiKeyChanged(false);
      setWorkerUrl(data.config["worker_url"] ?? "");
    } catch {
      setLoadError("Failed to load provider");
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    void fetchRecord();
  }, [fetchRecord]);

  // Pre-fill the test recipient with the signed-in admin's email. The
  // backend defaults to it anyway when `to` is omitted, but showing it
  // here makes the UX transparent ("I know where this goes").
  useEffect(() => {
    if (!testRecipient && session?.user?.email) {
      setTestRecipient(session.user.email);
    }
  }, [session, testRecipient]);

  async function handleTestSend() {
    try {
      setTesting(true);
      // Omit `to` when blank so the backend falls back to session.user.email.
      // The Input stays optional: emptying it is a documented happy path,
      // not an error.
      const to = testRecipient.trim();
      const res = await fetch(
        `/api/providers/${providerId}/test-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(to ? { to } : {}),
        },
      );
      if (!res.ok) {
        const data = (await res.json()) as {
          error?: string;
          details?: string;
        };
        throw new Error(data.details ?? data.error ?? "Send failed");
      }
      const data = (await res.json()) as { to: string; id: string };
      toast.success(`Test sent to ${data.to}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setTesting(false);
    }
  }

  const dirty = useMemo(() => {
    if (!record) return false;
    if (name !== record.name) return true;
    if (type !== record.type) return true;
    if (domain !== record.domain) return true;
    if (apiKeyChanged) return true;
    if (type === "cloudflare") {
      if (workerUrl !== (record.config["worker_url"] ?? "")) return true;
    }
    return false;
  }, [record, name, type, domain, apiKeyChanged, workerUrl]);

  const canSubmit =
    !!name.trim() &&
    !!domain.trim() &&
    (type === "resend" || !!workerUrl.trim()) &&
    dirty &&
    !saving;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    setError(null);

    // Only include `config` in the payload when something about it has
    // actually changed. The backend treats `config` as a full replacement
    // (re-validated against the effective type), so we MUST supply the
    // real api_key whenever we send it — we never have the real key client
    // side, so require the user to retype when config is touched.
    const workerUrlChanged =
      type === "cloudflare" &&
      workerUrl !== (record.config["worker_url"] ?? "");
    const typeChanged = type !== record.type;
    const configTouched = apiKeyChanged || workerUrlChanged || typeChanged;

    const payload: Record<string, unknown> = {};
    if (name !== record.name) payload["name"] = name.trim();
    if (domain !== record.domain) payload["domain"] = domain.trim();
    if (typeChanged) payload["type"] = type;

    if (configTouched) {
      if (!apiKeyChanged) {
        setError(
          "Re-enter the API key to change the provider config.",
        );
        return;
      }
      const cfg: Record<string, string> = { api_key: apiKey.trim() };
      if (type === "cloudflare") {
        cfg["worker_url"] = workerUrl.trim();
      }
      payload["config"] = cfg;
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
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      setDeleting(true);
      const res = await fetch(`/api/providers/${providerId}`, {
        method: "DELETE",
      });
      if (res.status === 409) {
        const data = (await res.json()) as {
          error: { message: string };
        };
        toast.error(data.error.message);
        return;
      }
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Provider deleted");
      router.push("/providers");
    } catch {
      toast.error("Failed to delete provider");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  if (loading) {
    return (
      <AppShell
        breadcrumbs={[
          { label: "Providers", href: "/providers" },
          { label: "Loading" },
        ]}
      >
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !record) {
    return (
      <AppShell
        breadcrumbs={[
          { label: "Providers", href: "/providers" },
          { label: "Error" },
        ]}
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">
            {loadError ?? "Provider not found"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void fetchRecord()}
          >
            Retry
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Providers", href: "/providers" },
        { label: record.name },
      ]}
    >
      <div className="flex flex-col gap-6 max-w-2xl">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display">
            {record.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update credentials or rotate the provider type.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>
              The API key is masked; retype it to change it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => void handleSave(e)}
              className="flex flex-col gap-5"
            >
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
                  onValueChange={(v) => setType(v as ProviderType)}
                  disabled={saving}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resend">Resend</SelectItem>
                    <SelectItem value="cloudflare">
                      Cloudflare Email
                    </SelectItem>
                  </SelectContent>
                </Select>
                {type !== record.type && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Type change: retype the API key (and supply a worker URL
                    if switching to Cloudflare) before saving.
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
                    apiKeyChanged
                      ? ""
                      : `Current: ${record.config["api_key"] ?? "(unset)"}`
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {apiKeyChanged
                    ? "New key staged — will replace the stored secret on save."
                    : "Leave blank to keep the current secret. Type a new key to replace it."}
                </p>
              </div>

              {type === "cloudflare" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="worker_url">Worker URL</Label>
                  <Input
                    id="worker_url"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    placeholder="https://dove-email.worker.example.com"
                    disabled={saving}
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" disabled={!canSubmit}>
                  {saving && (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  )}
                  Save changes
                </Button>
                <span
                  className={cn(
                    "text-xs",
                    dirty ? "text-amber-600" : "text-muted-foreground",
                  )}
                >
                  {dirty ? "Unsaved changes" : "Up to date"}
                </span>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send Test Email</CardTitle>
            <CardDescription>
              Dispatch a canned test through this provider. Defaults to
              your admin email. Respects EMAIL_DRY_RUN locally.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="test_to">Recipient</Label>
              <Input
                id="test_to"
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="admin@example.com"
                disabled={testing}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void handleTestSend()}
              disabled={testing}
              className="w-fit"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              )}
              Send Test
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Danger Zone</CardTitle>
            <CardDescription>
              Deleting a provider is blocked while any project still
              references it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              Delete Provider
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {record.name}?</DialogTitle>
            <DialogDescription>
              This removes the provider configuration. Projects that
              reference it must be reassigned first; otherwise the request
              is rejected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
