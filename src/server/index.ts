/**
 * Cloudflare Worker entry point.
 *
 * Hono app serving API routes and static assets (via Workers Static Assets).
 */

import { Hono } from "hono";
import type { Env } from "./env";
import { APP_VERSION } from "./lib/version";

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/live — Health check endpoint.
 *
 * Returns status, version, and database connectivity.
 */
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

export default app;
