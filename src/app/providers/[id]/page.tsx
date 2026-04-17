"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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

/**
 * The GET /api/providers response returns config with `api_key` masked as
 * "••••••last4". We treat an api_key field that starts with bullets as
 * "unchanged" — the user only sends a new api_key if they type one.
 */
const MASK_PREFIX = "••••••";

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
      setApiKey(data.config["api_key"] ?? "");
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
    // actually changed; otherwise we'd accidentally re-send the masked
    // api_key string and overwrite the real secret.
    const configTouched =
      apiKeyChanged ||
      (type === "cloudflare" &&
        workerUrl !== (record.config["worker_url"] ?? "")) ||
      type !== record.type;

    const payload: Record<string, unknown> = {};
    if (name !== record.name) payload["name"] = name.trim();
    if (domain !== record.domain) payload["domain"] = domain.trim();
    if (type !== record.type) payload["type"] = type;

    if (configTouched) {
      const cfg: Record<string, string> = {};
      // If the user left the key field alone, we reuse the stored real key
      // by NOT including api_key in the payload. But the outer config field
      // is a full replacement — so the backend needs the real key. Only
      // re-send the masked/unchanged key if the user has explicitly typed
      // something; otherwise we have to send the full current config with
      // the real key, which we don't have client-side.
      //
      // Resolution: require the user to retype the api_key whenever `type`
      // changes or the worker_url changes too. The backend returns 400 if
      // api_key looks like the masked placeholder.
      if (apiKeyChanged) {
        cfg["api_key"] = apiKey.trim();
      } else if (apiKey.startsWith(MASK_PREFIX)) {
        setError("Re-enter the API key to change the config.");
        return;
      } else {
        cfg["api_key"] = apiKey.trim();
      }
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
                  placeholder={apiKeyChanged ? "" : "Retype to change"}
                />
                <p className="text-xs text-muted-foreground">
                  {apiKeyChanged
                    ? "New key staged."
                    : "Leaving unchanged keeps the existing secret."}
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
