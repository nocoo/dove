/**
 * Cloudflare D1 proxy client — SQL queries via Worker HTTPS endpoint.
 *
 * Environment variables required:
 *   D1_WORKER_URL    — Worker endpoint (e.g. https://dove-worker.xxx.workers.dev)
 *   D1_WORKER_API_KEY — Shared secret for X-API-Key auth
 */

export interface D1ProxyResponse<T> {
  success: boolean;
  results?: T[];
  meta?: {
    changes: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
  };
  error?: string;
}

/** Max retry attempts for transient errors (5xx, network). */
const D1_MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff between retries. */
const D1_RETRY_BASE_MS = 500;

/**
 * Execute a SQL query against Cloudflare D1 via the Worker proxy.
 * Retries up to {@link D1_MAX_RETRIES} times on transient errors
 * (5xx, network) with exponential backoff (500ms → 1000ms → 2000ms).
 */
export async function executeD1Query<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const workerUrl = process.env.D1_WORKER_URL;
  const apiKey = process.env.D1_WORKER_API_KEY;

  if (!workerUrl || !apiKey) {
    throw new Error("D1 Worker credentials not configured");
  }

  const url = `${workerUrl}/query`;
  const requestBody = JSON.stringify({ sql, params });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= D1_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = D1_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(`D1 retry ${attempt}/${D1_MAX_RETRIES} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: requestBody,
      });
    } catch (err) {
      // Network error — retryable
      if (attempt < D1_MAX_RETRIES) {
        console.warn("D1 network error:", err);
        lastError =
          err instanceof Error ? err : new Error("D1 network error");
        continue;
      }
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text();

      if (attempt < D1_MAX_RETRIES && response.status >= 500) {
        console.warn("D1 transient error:", errorText);
        lastError = new Error("D1 query failed");
        continue;
      }

      // 401 = bad API key, 400 = bad request — not transient
      console.error("D1 Worker error:", response.status, errorText);
      throw new Error("D1 query failed");
    }

    const data: D1ProxyResponse<T> = await response.json();

    if (!data.success) {
      const detail = data.error ?? "Unknown D1 error";

      // D1 timeout errors are transient
      if (
        attempt < D1_MAX_RETRIES &&
        (detail.includes("7429") || detail.includes("exceeded timeout"))
      ) {
        console.warn("D1 transient API error:", detail);
        lastError = new Error("D1 query failed");
        continue;
      }

      console.error("D1 query error:", detail);
      if (/unique/i.test(detail)) {
        throw new Error("UNIQUE constraint failed");
      }
      throw new Error("D1 query failed");
    }

    return data.results ?? [];
  }

  // All retries exhausted
  throw lastError ?? new Error("D1 query failed");
}

/**
 * Check if D1 Worker is configured and available.
 */
export function isD1Configured(): boolean {
  return !!(process.env.D1_WORKER_URL && process.env.D1_WORKER_API_KEY);
}
