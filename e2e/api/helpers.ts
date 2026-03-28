/**
 * E2E API test helpers — real HTTP client for L2 tests.
 *
 * All requests go through the running dev server on port 17046.
 * No mocks, no in-process route imports.
 */

const BASE = `http://localhost:${process.env.PORT ?? 17046}`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
};

async function request(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const url = new URL(path, BASE);

  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...options.headers,
  };

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  return fetch(url.toString(), init);
}

export function get(path: string, options?: RequestOptions): Promise<Response> {
  return request("GET", path, options);
}

export function post(path: string, options?: RequestOptions): Promise<Response> {
  return request("POST", path, options);
}

export function put(path: string, options?: RequestOptions): Promise<Response> {
  return request("PUT", path, options);
}

export function del(path: string, options?: RequestOptions): Promise<Response> {
  return request("DELETE", path, options);
}

export function head(path: string, options?: RequestOptions): Promise<Response> {
  return request("HEAD", path, options);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export async function parseJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

export function webhookHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Test data lifecycle
// ---------------------------------------------------------------------------

/** Create a test project via the API. Returns the full project (with webhook_token). */
export async function setupTestProject(
  overrides: Record<string, unknown> = {},
): Promise<{
  id: string;
  name: string;
  webhook_token: string;
  [key: string]: unknown;
}> {
  const payload = {
    name: `E2E Project ${Date.now()}`,
    email_prefix: "e2e-test",
    from_name: "E2E Test",
    ...overrides,
  };

  const response = await post("/api/projects", { body: payload });
  if (response.status !== 201) {
    const text = await response.text();
    throw new Error(`Failed to create test project (${response.status}): ${text}`);
  }

  return parseJson(response);
}

/** Create a test recipient via the API. */
export async function setupTestRecipient(
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; email: string; [key: string]: unknown }> {
  const payload = {
    project_id: projectId,
    name: `E2E User ${Date.now()}`,
    email: `e2e-${Date.now()}@example.com`,
    ...overrides,
  };

  const response = await post("/api/recipients", { body: payload });
  if (response.status !== 201) {
    const text = await response.text();
    throw new Error(`Failed to create test recipient (${response.status}): ${text}`);
  }

  return parseJson(response);
}

/** Create a test template via the API. */
export async function setupTestTemplate(
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; [key: string]: unknown }> {
  const slug = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    project_id: projectId,
    name: `E2E Template ${Date.now()}`,
    slug,
    subject: "Hello {{name}}",
    body_markdown: "# Hi {{name}}\n\nWelcome!",
    variables: [{ name: "name", type: "string", required: true }],
    ...overrides,
  };

  const response = await post("/api/templates", { body: payload });
  if (response.status !== 201) {
    const text = await response.text();
    throw new Error(`Failed to create test template (${response.status}): ${text}`);
  }

  return parseJson(response);
}

/** Delete a project (cascades to recipients, templates, logs). */
export async function cleanupProject(projectId: string): Promise<void> {
  await del(`/api/projects/${projectId}`);
}
