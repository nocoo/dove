import { Hono } from "hono";
import type { Env } from "../env";
import { listAllWebhookLogs, listWebhookLogs } from "../lib/db/webhook-logs";

const webhookLogs = new Hono<{ Bindings: Env }>();

webhookLogs.get("/", async (c) => {
	const projectId = c.req.query("projectId");
	const limit = Number(c.req.query("limit") ?? "50");
	const offset = Number(c.req.query("offset") ?? "0");

	const logs = projectId
		? await listWebhookLogs(c.env.DB, projectId, { limit, offset })
		: await listAllWebhookLogs(c.env.DB, { limit, offset });

	return c.json(logs);
});

export { webhookLogs };
