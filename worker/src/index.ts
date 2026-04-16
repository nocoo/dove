/**
 * Dove D1 Proxy Worker
 *
 * Thin Cloudflare Worker that acts as a SQL proxy for D1.
 * The Dove app (on Railway) calls this worker over HTTPS
 * instead of connecting to D1 directly.
 *
 * Endpoints:
 *   GET  /api/live  — Surety-standard health check (public)
 *   POST /query     — D1 SQL proxy (requires X-API-Key)
 *
 * Required secrets (set via `wrangler secret put`):
 *   API_KEY — shared secret matching D1_WORKER_API_KEY on Railway side
 */

import { APP_VERSION } from "./version";

interface Env {
  DB: D1Database;
  API_KEY: string;
}

interface QueryRequest {
  sql: string;
  params?: unknown[];
}

const bootedAt = Date.now();

function handleLive(env: Env): Promise<Response> {
  const timestamp = new Date().toISOString();
  const uptime = Math.round((Date.now() - bootedAt) / 1000);

  const base = {
    version: APP_VERSION,
    component: "dove-worker",
    timestamp,
    uptime,
  };

  return (async () => {
    try {
      await env.DB.prepare("SELECT 1 AS probe").first();
      return Response.json(
        { status: "ok", ...base, database: { connected: true } },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : "D1 probe failed";
      const sanitized = raw.replace(/\bok\b/gi, "***");
      return Response.json(
        { status: "error", ...base, database: { connected: false, error: sanitized } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  })();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /api/live — public health check
    if (url.pathname === "/api/live" && request.method === "GET") {
      return handleLive(env);
    }

    // Only allow POST /query for everything else
    if (request.method !== "POST" || url.pathname !== "/query") {
      return Response.json(
        { success: false, error: "Not found. Use POST /query" },
        { status: 404 },
      );
    }

    // Validate API key
    const apiKey = request.headers.get("X-API-Key");
    if (!apiKey || apiKey !== env.API_KEY) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Parse request body
    let body: QueryRequest;
    try {
      body = (await request.json()) as QueryRequest;
    } catch {
      return Response.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.sql || typeof body.sql !== "string") {
      return Response.json(
        { success: false, error: "Missing or invalid 'sql' field" },
        { status: 400 },
      );
    }

    // Execute D1 query
    try {
      const stmt = env.DB.prepare(body.sql);
      const bound =
        body.params && body.params.length > 0
          ? stmt.bind(...body.params)
          : stmt;
      const result = await bound.all();

      return Response.json({
        success: true,
        results: result.results,
        meta: result.meta,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown D1 error";

      // UNIQUE constraint violations are deterministic client errors (not transient)
      const status = /unique/i.test(message) ? 400 : 500;

      return Response.json(
        { success: false, error: `D1_ERROR: ${message}` },
        { status },
      );
    }
  },
} satisfies ExportedHandler<Env>;
