"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";

interface Variable {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string | undefined;
}

interface Template {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  subject: string;
  body_markdown: string;
  variables: string | null;
  created_at: string;
  updated_at: string;
}

export default function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [variables, setVariables] = useState<Variable[]>([]);

  // Preview state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    void params.then((p) => setTemplateId(p.id));
  }, [params]);

  const fetchTemplate = useCallback(async () => {
    if (!templateId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/templates/${templateId}`);
      if (!res.ok) throw new Error("Template not found");

      const tmpl = await res.json() as Template;
      setTemplate(tmpl);
      setName(tmpl.name);
      setSlug(tmpl.slug);
      setSubject(tmpl.subject);
      setBodyMarkdown(tmpl.body_markdown);

      const parsed: Variable[] = tmpl.variables ? JSON.parse(tmpl.variables) as Variable[] : [];
      setVariables(parsed);
    } catch {
      setError("Failed to load template");
      toast.error("Failed to load template");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void fetchTemplate();
  }, [fetchTemplate]);

  // Parse original variables for dirty checking
  const originalVariables = useMemo(() => {
    if (!template?.variables) return "[]";
    return template.variables;
  }, [template]);

  const dirty = useMemo(() => {
    if (!template) return false;
    return (
      name !== template.name ||
      slug !== template.slug ||
      subject !== template.subject ||
      bodyMarkdown !== template.body_markdown ||
      JSON.stringify(variables) !== originalVariables
    );
  }, [template, name, slug, subject, bodyMarkdown, variables, originalVariables]);

  async function handleSave() {
    if (!templateId) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          subject: subject.trim(),
          body_markdown: bodyMarkdown,
          variables: variables.length > 0 ? variables : [],
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }

      const updated = await res.json() as Template;
      setTemplate(updated);
      toast.success("Template saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    if (!template) return;
    setName(template.name);
    setSlug(template.slug);
    setSubject(template.subject);
    setBodyMarkdown(template.body_markdown);
    const parsed: Variable[] = template.variables ? JSON.parse(template.variables) as Variable[] : [];
    setVariables(parsed);
  }

  async function handlePreview() {
    if (!templateId) return;
    try {
      setPreviewing(true);
      // First save if dirty
      if (dirty) {
        await handleSave();
      }

      const res = await fetch(`/api/templates/${templateId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: previewVars }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to preview");
      }

      const result = await res.json() as { subject: string; html: string };
      setPreviewSubject(result.subject);
      setPreviewHtml(result.html);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to preview template");
    } finally {
      setPreviewing(false);
    }
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

  async function handleDelete() {
    if (!templateId) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Template deleted");
      router.push("/templates");
    } catch {
      toast.error("Failed to delete template");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Templates", href: "/templates" }, { label: "..." }]}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (error && !template) {
    return (
      <AppShell breadcrumbs={[{ label: "Templates", href: "/templates" }, { label: "Error" }]}>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push("/templates")}>
            Back to Templates
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Templates", href: "/templates" }, { label: template?.name ?? "..." }]}>
      <div className="flex flex-col gap-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Editor */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template Settings</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="slug">Slug</Label>
                    <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={64} className="font-mono" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Body (Markdown)</CardTitle>
                <CardDescription>
                  Use {"{{variable_name}}"} for dynamic content.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={bodyMarkdown}
                  onChange={(e) => setBodyMarkdown(e.target.value)}
                  rows={16}
                  className="font-mono text-sm"
                />
              </CardContent>
            </Card>

            {/* Variables */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Variables</CardTitle>
                    <CardDescription>Declare template variables with types and defaults.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={addVariable}>
                    <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {variables.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No variables declared. Add one to validate template inputs.
                  </p>
                ) : (
                  variables.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
                        <Input
                          placeholder="name"
                          value={v.name}
                          onChange={(e) => updateVariable(i, { name: e.target.value })}
                          className="font-mono text-xs h-8"
                        />
                        <Select
                          value={v.type}
                          onValueChange={(val) => updateVariable(i, { type: val as Variable["type"] })}
                        >
                          <SelectTrigger className="text-xs h-8">
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
                          <SelectTrigger className="text-xs h-8">
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
                            className="text-xs h-8"
                          />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVariable(i)}
                        className="text-muted-foreground hover:text-destructive h-8 w-8 p-0 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Danger zone */}
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
              </CardHeader>
              <CardContent>
                <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                      Delete Template
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete Template?</DialogTitle>
                      <DialogDescription>
                        This will permanently delete the template <strong>{template?.name}</strong>.
                        Existing send logs referencing this template will not be affected.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                        {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Delete
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </div>

          {/* Right: Preview */}
          <div className="flex flex-col gap-4">
            <Card className="sticky top-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Preview</CardTitle>
                    <CardDescription>Rendered email output.</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePreview()}
                    disabled={previewing}
                  >
                    {previewing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                    )}
                    Render
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Preview variables input */}
                {variables.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Sample Variables</p>
                    {variables.map((v) => (
                      <div key={v.name} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-24 shrink-0 truncate">
                          {v.name}
                        </span>
                        <Input
                          value={previewVars[v.name] ?? v.default ?? ""}
                          onChange={(e) =>
                            setPreviewVars((prev) => ({ ...prev, [v.name]: e.target.value }))
                          }
                          className="text-xs h-7"
                          placeholder={v.default ?? (v.required ? "required" : "optional")}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {previewSubject && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Subject</p>
                    <p className="text-sm font-medium text-foreground">{previewSubject}</p>
                  </div>
                )}

                {previewHtml ? (
                  <div className="rounded-lg border border-border bg-white p-4 overflow-auto max-h-[500px]">
                    <div
                      className="prose prose-sm max-w-none text-foreground"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 rounded-lg border border-dashed border-border">
                    <p className="text-xs text-muted-foreground">
                      Click &quot;Render&quot; to preview the template.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
