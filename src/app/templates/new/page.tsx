"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewTemplateFormSkeleton } from "@/components/skeletons";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Project {
  id: string;
  name: string;
}

interface Variable {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string | undefined;
}

function NewTemplateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedProjectId = searchParams.get("projectId");

  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState(preselectedProjectId ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [variables, setVariables] = useState<Variable[]>([]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setProjects(await res.json() as Project[]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-generate slug from name
  function handleNameChange(value: string) {
    setName(value);
    if (!slug || slug === nameToSlug(name)) {
      setSlug(nameToSlug(value));
    }
  }

  function nameToSlug(n: string): string {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  }

  function addVariable() {
    setVariables([...variables, { name: "", type: "string", required: true }]);
  }

  function updateVariable(index: number, updates: Partial<Variable>) {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...updates } : v)),
    );
  }

  function removeVariable(index: number) {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      setSaving(true);
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: name.trim(),
          slug: slug.trim(),
          subject: subject.trim(),
          body_markdown: bodyMarkdown,
          variables: variables.length > 0 ? variables : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to create template");
      }

      const template = await res.json() as { id: string };
      toast.success("Template created");
      router.push(`/templates/${template.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create template";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    projectId && name.trim() && slug.trim() && subject.trim() && bodyMarkdown.trim() && !saving;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">New Template</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a Markdown email template with optional variables.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Welcome Email"
              maxLength={128}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="welcome-email"
              maxLength={64}
              disabled={saving}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="subject">Subject Line</Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Welcome to {{app_name}}"
            maxLength={500}
            disabled={saving}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="body">Body (Markdown)</Label>
          <Textarea
            id="body"
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder={"# Welcome, {{name}}!\n\nThank you for signing up..."}
            rows={12}
            disabled={saving}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Use {"{{variable_name}}"} for dynamic content. Markdown will be converted to HTML.
          </p>
        </div>

        {/* Variables */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label>Variables</Label>
            <Button type="button" variant="outline" size="sm" onClick={addVariable}>
              <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              Add Variable
            </Button>
          </div>

          {variables.map((v, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
                <Input
                  placeholder="name"
                  value={v.name}
                  onChange={(e) => updateVariable(i, { name: e.target.value })}
                  className="font-mono text-sm"
                  disabled={saving}
                />
                <Select
                  value={v.type}
                  onValueChange={(val) => updateVariable(i, { type: val as Variable["type"] })}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={v.required ? "required" : "optional"}
                  onValueChange={(val) => updateVariable(i, { required: val === "required" })}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">Required</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                  </SelectContent>
                </Select>
                {!v.required && (
                  <Input
                    placeholder="default"
                    value={v.default ?? ""}
                    onChange={(e) =>
                      updateVariable(i, { default: e.target.value || undefined })
                    }
                    className="text-sm"
                    disabled={saving}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeVariable(i)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={!canSubmit}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Create Template
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewTemplatePage() {
  return (
    <AppShell breadcrumbs={[{ label: "Templates", href: "/templates" }, { label: "New" }]}>
      <Suspense
        fallback={<NewTemplateFormSkeleton />}
      >
        <NewTemplateForm />
      </Suspense>
    </AppShell>
  );
}
