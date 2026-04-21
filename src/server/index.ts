/**
 * Cloudflare Worker entry point.
 *
 * Hono app serving API routes and static assets (via Workers Static Assets).
 */

import { Hono } from "hono";
import type { Env } from "./env";
import { APP_VERSION } from "./lib/version";
import { authSession } from "./middleware/auth-session";
import { auth } from "./routes/auth";
import { projects } from "./routes/projects";
import { recipients } from "./routes/recipients";
import { templates } from "./routes/templates";
import { providers } from "./routes/providers";
import { sendLogs } from "./routes/send-logs";
import { webhookLogs } from "./routes/webhook-logs";
import { stats } from "./routes/stats";
import { webhook } from "./routes/webhook";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", authSession);

app.get("/api/live", async (c) => {
  let dbConnected = false;
  let dbError: string | null = null;

  try {
    const result = await c.env.DB.prepare("SELECT 1 AS ping").first();
    dbConnected = result !== null;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  const status = dbConnected ? "ok" : "error";
  const statusCode = dbConnected ? 200 : 503;

  return c.json(
    {
      status,
      version: APP_VERSION,
      component: "dove",
      database: {
        connected: dbConnected,
        ...(dbError ? { error: dbError } : {}),
      },
    },
    statusCode,
  );
});

app.route("/api/auth", auth);
app.route("/api/projects", projects);
app.route("/api/recipients", recipients);
app.route("/api/templates", templates);
app.route("/api/providers", providers);
app.route("/api/send-logs", sendLogs);
app.route("/api/webhook-logs", webhookLogs);
app.route("/api/stats", stats);
app.route("/api/webhook", webhook);

export default app;
