import { Button, Input, Label, LayerCard, toast } from "@nocoo/basalt";
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
import { Eye, Loader2, Plus, Send, Trash2 } from "@nocoo/basalt/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { TemplateDetailSkeleton } from "@/components/skeletons";

interface Variable {
	name: string;
	type: "string" | "number" | "boolean";
	required: boolean;
	default?: string | undefined;
}

/** Client-only row id for React keys; never persisted to the API. */
interface EditorVariable extends Variable {
	uid: string;
}

function withUid(v: Variable): EditorVariable {
	return { ...v, uid: crypto.randomUUID() };
}

function stripUid(v: EditorVariable): Variable {
	const { uid: _, ...rest } = v;
	void _;
	return rest;
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

export function TemplateDetailPage() {
	const navigate = useNavigate();
	const { id: templateId } = useParams<"id">();
	const [template, setTemplate] = useState<Template | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// Form state
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [subject, setSubject] = useState("");
	const [bodyMarkdown, setBodyMarkdown] = useState("");
	const [variables, setVariables] = useState<EditorVariable[]>([]);

	// Preview state
	const [previewHtml, setPreviewHtml] = useState<string | null>(null);
	const [previewSubject, setPreviewSubject] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [previewVars, setPreviewVars] = useState<Record<string, string>>({});

	// Delete state
	const [deleting, setDeleting] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	// Test send state
	const [testTo, setTestTo] = useState("");
	const [sending, setSending] = useState(false);
	const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

	const fetchTemplate = useCallback(async () => {
		if (!templateId) return;
		try {
			setLoading(true);
			setError(null);
			const res = await fetch(`/api/templates/${templateId}`);
			if (!res.ok) throw new Error("Template not found");

			const tmpl = (await res.json()) as Template;
			setTemplate(tmpl);
			setName(tmpl.name);
			setSlug(tmpl.slug);
			setSubject(tmpl.subject);
			setBodyMarkdown(tmpl.body_markdown);

			const parsed: Variable[] = tmpl.variables ? (JSON.parse(tmpl.variables) as Variable[]) : [];
			setVariables(parsed.map(withUid));
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
			JSON.stringify(variables.map(stripUid)) !== originalVariables
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
					variables: variables.length > 0 ? variables.map(stripUid) : [],
				}),
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Failed to save");
			}

			const updated = (await res.json()) as Template;
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
		const parsed: Variable[] = template.variables
			? (JSON.parse(template.variables) as Variable[])
			: [];
		setVariables(parsed.map(withUid));
	}

	async function handlePreview() {
		if (!templateId) return;
		try {
			setPreviewing(true);
			if (dirty) {
				await handleSave();
			}

			const mergedPreviewVars: Record<string, string> = {};
			for (const v of variables) {
				if (v.name) {
					mergedPreviewVars[v.name] = previewVars[v.name] ?? v.default ?? "";
				}
			}
			const res = await fetch(`/api/templates/${templateId}/preview`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ variables: mergedPreviewVars }),
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Failed to preview");
			}

			const result = (await res.json()) as { subject: string; html: string };
			setPreviewSubject(result.subject);
			setPreviewHtml(result.html);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to preview template");
		} finally {
			setPreviewing(false);
		}
	}

	function addVariable() {
		setVariables([...variables, withUid({ name: "", type: "string", required: true })]);
	}

	function updateVariable(index: number, updates: Partial<Variable>) {
		setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, ...updates } : v)));
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
			void navigate("/templates");
		} catch {
			toast.error("Failed to delete template");
		} finally {
			setDeleting(false);
			setDeleteDialogOpen(false);
		}
	}

	async function handleTestSend() {
		if (!templateId || !testTo.trim()) return;
		try {
			setSending(true);
			setSendResult(null);
			if (dirty) {
				await handleSave();
			}
			const mergedVars: Record<string, string> = {};
			for (const v of variables) {
				if (v.name) {
					mergedVars[v.name] = previewVars[v.name] ?? v.default ?? "";
				}
			}
			const res = await fetch(`/api/templates/${templateId}/test-send`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ to: testTo.trim(), variables: mergedVars }),
			});
			let data: { status?: string; provider_type?: string; error?: string };
			try {
				data = (await res.json()) as typeof data;
			} catch {
				throw new Error(`Server returned ${res.status}`);
			}
			if (!res.ok) {
				throw new Error(data.error ?? `Server returned ${res.status}`);
			}
			setSendResult({ ok: true, message: `Sent via ${data.provider_type}` });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to send test email";
			setSendResult({ ok: false, message });
		} finally {
			setSending(false);
		}
	}

	if (loading) {
		return <TemplateDetailSkeleton />;
	}

	if (error && !template) {
		return (
			<div className="rounded-lg border border-basalt-destructive/30 bg-basalt-destructive/5 p-6 text-center">
				<p className="text-basalt-sm text-basalt-destructive">{error}</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-3"
					onClick={() => void navigate("/templates")}
				>
					Back to Templates
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
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

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left: Editor */}
				<div className="flex flex-col gap-6">
					<LayerCard>
						<LayerCard.Header>
							<h3 className="text-basalt-base">Template Settings</h3>
							<p>Name, slug, and subject line.</p>
						</LayerCard.Header>
						<LayerCard.Body className="flex flex-col gap-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="flex flex-col gap-2">
									<Label htmlFor="name">Name</Label>
									<Input
										id="name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										maxLength={128}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="slug">Slug</Label>
									<Input
										id="slug"
										value={slug}
										onChange={(e) => setSlug(e.target.value)}
										maxLength={64}
										className="font-mono"
									/>
								</div>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="subject">Subject</Label>
								<Input
									id="subject"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									maxLength={500}
								/>
							</div>
						</LayerCard.Body>
					</LayerCard>

					<LayerCard>
						<LayerCard.Header>
							<h3 className="text-basalt-base">Body (Markdown)</h3>
							<p>Use {"{{variable_name}}"} for dynamic content.</p>
						</LayerCard.Header>
						<LayerCard.Body>
							<InputArea
								value={bodyMarkdown}
								onChange={(e) => setBodyMarkdown(e.target.value)}
								rows={16}
								className="font-mono text-basalt-sm"
							/>
						</LayerCard.Body>
					</LayerCard>

					{/* Variables */}
					<LayerCard>
						<LayerCard.Header>
							<div className="flex items-center justify-between">
								<div>
									<h3 className="text-basalt-base">Variables</h3>
									<p>Declare template variables with types and defaults.</p>
								</div>
								<Button variant="outline" size="sm" onClick={addVariable}>
									<Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
									Add
								</Button>
							</div>
						</LayerCard.Header>
						<LayerCard.Body className="flex flex-col gap-2">
							{variables.length === 0 ? (
								<p className="text-basalt-xs text-basalt-muted-foreground text-center py-3">
									No variables declared. Add one to validate template inputs.
								</p>
							) : (
								variables.map((v, i) => (
									<div
										key={v.uid}
										className="flex items-start gap-2 rounded-basalt-md bg-basalt-muted/20 p-2.5"
									>
										<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
											<Input
												placeholder="name"
												value={v.name}
												onChange={(e) => updateVariable(i, { name: e.target.value })}
												className="font-mono text-basalt-xs h-8"
											/>
											<Select
												value={v.type}
												onValueChange={(val: string) =>
													updateVariable(i, { type: val as Variable["type"] })
												}
											>
												<SelectTrigger className="text-basalt-xs h-8">
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
												onValueChange={(val: string) =>
													updateVariable(i, { required: val === "required" })
												}
											>
												<SelectTrigger className="text-basalt-xs h-8">
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
													className="text-basalt-xs h-8"
												/>
											)}
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => removeVariable(i)}
											className="text-basalt-muted-foreground hover:text-basalt-destructive h-8 w-8 p-0 shrink-0"
										>
											<Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
										</Button>
									</div>
								))
							)}
						</LayerCard.Body>
					</LayerCard>

					{/* Danger zone */}
					<LayerCard className="ring-1 ring-basalt-destructive/30">
						<LayerCard.Header>
							<h3 className="text-basalt-base text-basalt-destructive">Danger Zone</h3>
						</LayerCard.Header>
						<LayerCard.Body>
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
										<Button
											variant="outline"
											onClick={() => setDeleteDialogOpen(false)}
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
						</LayerCard.Body>
					</LayerCard>
				</div>

				{/* Right: Preview */}
				<LayerCard className="sticky top-0 self-start">
					<LayerCard.Header>
						<h3 className="text-basalt-base">Preview</h3>
						<p>Rendered email output.</p>
						<div className="ml-auto">
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
					</LayerCard.Header>
					<LayerCard.Body className="flex flex-col gap-4">
						{/* Preview variables input */}
						{variables.length > 0 && (
							<div className="flex flex-col gap-2">
								<p className="text-basalt-xs font-medium text-basalt-muted-foreground">
									Sample Variables
								</p>
								{variables.map((v) => (
									<div key={v.name} className="flex items-center gap-2">
										<span className="text-basalt-xs font-mono text-basalt-muted-foreground w-24 shrink-0 truncate">
											{v.name}
										</span>
										<Input
											value={previewVars[v.name] ?? v.default ?? ""}
											onChange={(e) =>
												setPreviewVars((prev) => ({ ...prev, [v.name]: e.target.value }))
											}
											className="text-basalt-xs h-7"
											placeholder={v.default ?? (v.required ? "required" : "optional")}
										/>
									</div>
								))}
							</div>
						)}

						{previewSubject && (
							<div>
								<p className="text-basalt-xs uppercase tracking-wider text-basalt-muted-foreground mb-1">
									Subject
								</p>
								<p className="text-basalt-sm font-medium text-basalt-foreground">
									{previewSubject}
								</p>
							</div>
						)}

						{previewHtml ? (
							<div className="rounded-lg border border-basalt-border bg-basalt-background p-4 overflow-auto max-h-[500px]">
								<div
									className="prose prose-sm max-w-none text-basalt-foreground"
									dangerouslySetInnerHTML={{ __html: previewHtml }}
								/>
							</div>
						) : (
							<div className="flex items-center justify-center py-8 rounded-basalt-lg bg-basalt-secondary">
								<p className="text-basalt-xs text-basalt-muted-foreground">
									Click &quot;Render&quot; to preview the template.
								</p>
							</div>
						)}

						<div className="border-t border-basalt-border pt-4">
							<p className="text-basalt-xs font-medium text-basalt-muted-foreground mb-2">
								Send Test Email
							</p>
							<div className="flex items-center gap-2">
								<Input
									type="email"
									placeholder="recipient@example.com"
									value={testTo}
									onChange={(e) => setTestTo(e.target.value)}
									className="text-basalt-sm h-8"
								/>
								<Button
									size="sm"
									variant="outline"
									onClick={() => void handleTestSend()}
									disabled={sending || !testTo.trim()}
								>
									{sending ? (
										<Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
									) : (
										<Send className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
									)}
									Send
								</Button>
							</div>
							{sendResult && (
								<p
									className={`text-basalt-xs mt-2 ${sendResult.ok ? "text-basalt-success" : "text-basalt-destructive"}`}
								>
									{sendResult.ok ? "✓ " : "✗ "}
									{sendResult.message}
								</p>
							)}
						</div>
					</LayerCard.Body>
				</LayerCard>
			</div>
		</div>
	);
}
