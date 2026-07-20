import { Hono } from "hono";
import type { Env } from "../env";
import { listAllSendLogs, listSendLogs } from "../lib/db/send-logs";

const sendLogs = new Hono<{ Bindings: Env }>();

sendLogs.get("/", async (c) => {
	const projectId = c.req.query("projectId");
	const status = c.req.query("status");
	const limit = Number(c.req.query("limit") ?? "50");
	const offset = Number(c.req.query("offset") ?? "0");

	const logs = projectId
		? await listSendLogs(c.env.DB, projectId, { limit, offset, status })
		: await listAllSendLogs(c.env.DB, { limit, offset, status });

	return c.json(logs);
});

export { sendLogs };
