import { Hono } from "hono";
import { z } from "zod/v4";
import type { Env } from "../env";
import {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  regenerateToken,
} from "../lib/db/projects";
import { sanitizeProject } from "../lib/sanitize";

const projects = new Hono<{ Bindings: Env }>();

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  email_prefix: z.string().min(1).max(64),
  from_name: z.string().min(1).max(128),
  quota_daily: z.number().int().min(1).optional(),
  quota_monthly: z.number().int().min(1).optional(),
  provider_id: z.string().min(1).nullable().optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  email_prefix: z.string().min(1).max(64).optional(),
  from_name: z.string().min(1).max(128).optional(),
  quota_daily: z.number().int().min(1).optional(),
  quota_monthly: z.number().int().min(1).optional(),
  provider_id: z.string().min(1).nullable().optional(),
});

projects.get("/", async (c) => {
  const list = await listProjects(c.env.DB);
  return c.json(list.map(sanitizeProject));
});

projects.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  const project = await createProject(c.env.DB, parsed.data);
  return c.json(project, 201);
});

projects.get("/:id", async (c) => {
  const project = await getProject(c.env.DB, c.req.param("id"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(sanitizeProject(project));
});

projects.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  const updated = await updateProject(c.env.DB, c.req.param("id"), parsed.data);
  if (!updated) return c.json({ error: "Project not found" }, 404);
  return c.json(sanitizeProject(updated));
});

projects.delete("/:id", async (c) => {
  const deleted = await deleteProject(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "Project not found" }, 404);
  return c.body(null, 204);
});

projects.post("/:id/token", async (c) => {
  const token = await regenerateToken(c.env.DB, c.req.param("id"));
  if (!token) return c.json({ error: "Project not found" }, 404);
  return c.json({ webhook_token: token });
});

export { projects };
