import { Hono } from "hono";
import { z } from "zod/v4";
import type { Env } from "../env";
import {
  listRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from "../lib/db/recipients";

const recipients = new Hono<{ Bindings: Env }>();

const CreateRecipientSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1).max(128),
  email: z.string().email().max(320),
});

const UpdateRecipientSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.string().email().max(320).optional(),
});

recipients.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "Missing projectId query parameter" }, 400);
  }
  const list = await listRecipients(c.env.DB, projectId);
  return c.json(list);
});

recipients.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateRecipientSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  try {
    const recipient = await createRecipient(c.env.DB, parsed.data);
    return c.json(recipient, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return c.json({ error: "This email already exists for this project" }, 409);
    }
    throw error;
  }
});

recipients.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = UpdateRecipientSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  try {
    const updated = await updateRecipient(c.env.DB, c.req.param("id"), parsed.data);
    if (!updated) return c.json({ error: "Recipient not found" }, 404);
    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return c.json({ error: "This email already exists for this project" }, 409);
    }
    throw error;
  }
});

recipients.delete("/:id", async (c) => {
  const deleted = await deleteRecipient(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "Recipient not found" }, 404);
  return c.body(null, 204);
});

export { recipients };
