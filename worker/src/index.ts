/**
 * Dove D1 Proxy Worker
 *
 * Thin Cloudflare Worker that acts as a SQL proxy for D1.
 * The Dove app (on Railway) calls this worker over HTTPS
 * instead of connecting to D1 directly.
 *
 * Single endpoint: POST /query
 * Auth: X-API-Key header (shared secret)
 * Body: { sql: string, params?: unknown[] }
 *
 * Required secrets (set via `wrangler secret put`):
 *   API_KEY — shared secret matching D1_WORKER_API_KEY on Railway side
 */

interface Env {
  DB: D1Database;
  API_KEY: string;
}

interface QueryRequest {
  sql: string;
  params?: unknown[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only allow POST /query
    const url = new URL(request.url);
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
      return Response.json(
        { success: false, error: `D1_ERROR: ${message}` },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
