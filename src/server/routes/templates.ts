import { Hono } from "hono";
import { z } from "zod/v4";
import type { Env } from "../env";
import {
  listTemplates,
  listAllTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  parseVariables,
} from "../lib/db/templates";
import { getProject } from "../lib/db/projects";
import { getEmailProvider } from "../lib/db/email-providers";
import {
  createProvider,
  createLegacyProvider,
  parseProviderConfig,
  getProviderDomain,
  type EmailProvider,
} from "../lib/email/provider";
import { renderTemplate } from "@/lib/email/render";
import { IdempotentSendResult } from "@/lib/email/providers/cloudflare";
import { generateId } from "@/lib/id";

const templates = new Hono<{ Bindings: Env }>();

const VariableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
  default: z.string().optional(),
});

const CreateTemplateSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Slug must be lowercase alphanumeric with hyphens/underscores"),
  subject: z.string().min(1).max(500),
  body_markdown: z.string().min(1),
  variables: z.array(VariableSchema).optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Slug must be lowercase alphanumeric with hyphens/underscores").optional(),
  subject: z.string().min(1).max(500).optional(),
  body_markdown: z.string().min(1).optional(),
  variables: z.array(VariableSchema).optional(),
});

const PreviewSchema = z.object({
  variables: z.record(z.string(), z.string()).optional(),
});

templates.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const list = projectId
    ? await listTemplates(c.env.DB, projectId)
    : await listAllTemplates(c.env.DB);
  return c.json(list);
});

templates.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  try {
    const template = await createTemplate(c.env.DB, parsed.data);
    return c.json(template, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return c.json({ error: "A template with this slug already exists in this project" }, 409);
    }
    throw error;
  }
});

templates.get("/:id", async (c) => {
  const template = await getTemplate(c.env.DB, c.req.param("id"));
  if (!template) return c.json({ error: "Template not found" }, 404);
  return c.json(template);
});

templates.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = UpdateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  try {
    const updated = await updateTemplate(c.env.DB, c.req.param("id"), parsed.data);
    if (!updated) return c.json({ error: "Template not found" }, 404);
    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return c.json({ error: "A template with this slug already exists in this project" }, 409);
    }
    throw error;
  }
});

templates.delete("/:id", async (c) => {
  const deleted = await deleteTemplate(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "Template not found" }, 404);
  return c.body(null, 204);
});

templates.post("/:id/preview", async (c) => {
  const template = await getTemplate(c.env.DB, c.req.param("id"));
  if (!template) return c.json({ error: "Template not found" }, 404);

  const body = await c.req.json();
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  try {
    const schema = parseVariables(template);
    const variables = parsed.data.variables ?? {};
    const result = await renderTemplate(
      template.subject,
      template.body_markdown,
      schema,
      variables,
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ error: error.message }, 422);
    }
    throw error;
  }
});

const TestSendSchema = z.object({
  to: z.email(),
  variables: z.record(z.string(), z.string()).optional(),
});

templates.post("/:id/test-send", async (c) => {
  try {
    const template = await getTemplate(c.env.DB, c.req.param("id"));
    if (!template) return c.json({ error: "Template not found" }, 404);

    const body = await c.req.json();
    const parsed = TestSendSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }

    const project = await getProject(c.env.DB, template.project_id);
    if (!project) {
      return c.json({ error: "Project not found for this template" }, 500);
    }

    let provider: EmailProvider;
    let providerRecord: Awaited<ReturnType<typeof getEmailProvider>> | null = null;
    let providerType: string;

    if (project.provider_id) {
      const record = await getEmailProvider(c.env.DB, project.provider_id);
      if (!record) return c.json({ error: "Configured email provider not found" }, 500);
      providerRecord = record;
      provider = await createProvider(parseProviderConfig(record), c.env.EMAIL, c.env.DB);
      providerType = record.type;
    } else {
      provider = await createLegacyProvider(c.env);
      providerType = "legacy";
    }

    const domain = getProviderDomain(providerRecord, c.env);
    const schema = parseVariables(template);
    const variables = parsed.data.variables ?? {};
    const rendered = await renderTemplate(template.subject, template.body_markdown, schema, variables);

    const from = `${project.from_name} <${project.email_prefix}@${domain}>`;
    try {
      await provider.send({
        from,
        to: parsed.data.to,
        subject: rendered.subject,
        html: rendered.html,
        idempotencyKey: generateId(),
      });
    } catch (error) {
      if (error instanceof IdempotentSendResult) {
        return c.json({ status: "sent", provider_type: providerType });
      }
      throw error;
    }

    return c.json({ status: "sent", provider_type: providerType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[test-send]", message, error);
    return c.json({ error: message }, 500);
  }
});

export { templates };
