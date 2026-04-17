# Multi-Provider Email System Design

## Context

Dove currently supports only Resend as the email sending provider. This design introduces a modular provider architecture that supports multiple email backends (Resend, Cloudflare Email) with per-project configuration.

### Goals

1. **Modular Provider System** — Abstract email sending behind a unified interface
2. **Multi-Provider Configurations** — Store multiple provider credentials (users may have different domains on different providers)
3. **Per-Project Provider Selection** — Each project chooses which provider config to use
4. **Cloudflare Email Support** — Add CF Worker-based email sending as a new provider
5. **Idempotency Parity** — CF path must provide the same duplicate-prevention guarantees as Resend path

### Non-Goals

- Migration tooling (handled separately)
- UI changes (deferred to implementation phase)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Next.js App                                    │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────────────────────┐   │
│  │  Webhook Route  │───▶│            Provider Layer                    │   │
│  │   /send         │    │                                              │   │
│  └─────────────────┘    │  ┌────────────────┐  ┌────────────────────┐  │   │
│                         │  │ ResendProvider │  │ CloudflareProvider │  │   │
│                         │  │ (direct HTTP)  │  │ (via CF Worker)    │  │   │
│                         │  └───────┬────────┘  └─────────┬──────────┘  │   │
│                         └──────────┼─────────────────────┼─────────────┘   │
│                                    │                     │                 │
└────────────────────────────────────┼─────────────────────┼─────────────────┘
                                     │                     │
                                     ▼                     ▼
                          ┌──────────────────┐   ┌──────────────────────────┐
                          │   Resend API     │   │  CF Email Worker         │
                          │ api.resend.com   │   │  (new, dedicated)        │
                          └──────────────────┘   │                          │
                                                 │  POST /send              │
                                                 │  Auth: X-API-Key         │
                                                 │  Idempotency: D1-based   │
                                                 │                          │
                                                 │  Uses:                   │
                                                 │  - cloudflare:email      │
                                                 │  - mimetext              │
                                                 │  - D1 for atomic dedup   │
                                                 └──────────────────────────┘
```

---

## Data Model

### New Table: `email_providers`

Stores provider configurations. Each record represents a configured provider instance with its credentials and domain.

```sql
CREATE TABLE IF NOT EXISTS email_providers (
  id TEXT PRIMARY KEY,                    -- nanoid
  name TEXT NOT NULL,                     -- Display name, e.g. "Production Resend"
  type TEXT NOT NULL,                     -- "resend" | "cloudflare"
  domain TEXT NOT NULL,                   -- Email domain, e.g. "mail.example.com"
  config TEXT NOT NULL,                   -- JSON: provider-specific credentials
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, domain)                    -- One config per provider+domain combo
);
```

#### Config JSON Schema

**Resend:**
```json
{
  "api_key": "re_xxxx..."
}
```

**Cloudflare:**
```json
{
  "worker_url": "https://dove-email.worker.example.com",
  "api_key": "secret-key-for-worker-auth"
}
```

### Modified Table: `projects`

Add a foreign key to link each project to its email provider:

```sql
ALTER TABLE projects ADD COLUMN provider_id TEXT REFERENCES email_providers(id);
```

**Behavior Rules:**

| `provider_id` State | Behavior |
|---------------------|----------|
| Valid ID | Use the referenced provider |
| `NULL` | **Fallback to legacy mode**: use `RESEND_API_KEY` and `RESEND_FROM_DOMAIN` env vars |

> **Rationale:** The `NULL` fallback ensures backward compatibility during rollout. Existing projects continue working without migration. New projects created via API will default to `NULL` (legacy mode) unless explicitly assigned a provider.

### Modified Table: `send_logs`

Add columns to snapshot which provider was used at send time, and generalize the provider-specific message ID column:

```sql
ALTER TABLE send_logs ADD COLUMN provider_id TEXT;
ALTER TABLE send_logs ADD COLUMN provider_type TEXT;  -- "resend" | "cloudflare" | "legacy"
ALTER TABLE send_logs ADD COLUMN provider_message_id TEXT;  -- replaces resend_id semantically
```

- `provider_id` — Nullable; `NULL` for legacy sends
- `provider_type` — Always populated; `"legacy"` when using env-var-based Resend
- `provider_message_id` — Provider-agnostic successor to `resend_id`. For Resend sends this holds the Resend UUID; for CF sends this holds the `cf_xxx` ID.
- `resend_id` — **Retained, not dropped.** Remains populated on Resend sends for backward compatibility of any historical queries. On CF sends it stays `NULL`. See "Public API & UI Contract" below for the rollout.

> **Rationale:** This enables filtering, debugging, and auditing per-provider. When a project is reassigned to a different provider, historical logs retain the original provider context.

### Relationship Diagram

```
email_providers (1) ◄──── (N) projects
      │
      │  id: "prov_abc123"
      │  name: "Hexly Resend"
      │  type: "resend"
      │  domain: "mail.hexly.ai"
      │  config: {"api_key": "re_xxx"}
      │
      └──► project.provider_id = "prov_abc123"
           project.email_prefix = "noreply"
           → sends from: noreply@mail.hexly.ai

send_logs
      │
      │  provider_id: "prov_abc123"
      │  provider_type: "resend"
      │  → Immutable snapshot at send time
```

---

## Provider Interface

### TypeScript Interface

```typescript
// src/lib/email/provider.ts

export interface SendParams {
  from: string;           // Full "Name <email@domain>" format
  to: string;             // Recipient email
  subject: string;        // Rendered subject
  html: string;           // Rendered HTML body
  idempotencyKey: string; // REQUIRED: Provider must use for dedup
}

export interface SendResult {
  id: string;             // Provider-specific message ID
}

export interface EmailProvider {
  readonly type: "resend" | "cloudflare";

  /**
   * Send an email through this provider.
   *
   * IDEMPOTENCY CONTRACT (layered):
   *
   * Layer 1 (authoritative): The Next.js webhook route enforces idempotency via
   * `send_logs` UNIQUE(project_id, idempotency_key). A caller-side retry with
   * the same idempotency_key returns the cached send_log without invoking the
   * provider again. This is the PRIMARY guarantee.
   *
   * Layer 2 (best-effort): Provider SHOULD use idempotencyKey to dedupe when
   * possible. This catches edge cases where Next.js retries after an ambiguous
   * network failure (Next.js marked send_log as "failed" but the provider
   * actually succeeded). Because send_log.id is stable across retries, the
   * provider receives the same idempotencyKey.
   *
   * Provider Layer 2 guarantees:
   * - Resend: Uses Idempotency-Key header (provider-enforced, 24h window)
   * - Cloudflare: Uses D1 UNIQUE constraint for atomic check-and-insert (see Worker design)
   *
   * NOTE: Layer 2 is best-effort with a finite dedup window. Beyond that window,
   * Layer 1's UNIQUE constraint on send_logs remains the unconditional guarantee.
   *
   * Throws on failure (after retries).
   */
  send(params: SendParams): Promise<SendResult>;

  /**
   * Check if provider supports dry-run mode.
   * When enabled, provider validates params but does not send.
   */
  supportsDryRun(): boolean;

  /**
   * Enable/disable dry-run mode.
   * Used by tests to exercise full pipeline without actual sends.
   */
  setDryRun(enabled: boolean): void;
}
```

### Provider Factory

```typescript
// src/lib/email/provider.ts

export type ProviderConfig =
  | { type: "resend"; api_key: string }
  | { type: "cloudflare"; worker_url: string; api_key: string };

export function createProvider(config: ProviderConfig): EmailProvider {
  switch (config.type) {
    case "resend":
      return new ResendProvider(config.api_key);
    case "cloudflare":
      return new CloudflareProvider(config.worker_url, config.api_key);
    default:
      throw new Error(`Unknown provider type: ${(config as never).type}`);
  }
}

/**
 * Create provider from legacy env vars.
 * Used when project.provider_id is NULL.
 */
export function createLegacyProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }
  return new ResendProvider(apiKey);
}

/**
 * Get the sending domain for a provider.
 * For legacy mode, returns RESEND_FROM_DOMAIN env var.
 */
export function getProviderDomain(provider: EmailProviderRecord | null): string {
  if (provider) {
    return provider.domain;
  }
  const domain = process.env.RESEND_FROM_DOMAIN;
  if (!domain) {
    throw new Error("RESEND_FROM_DOMAIN not configured");
  }
  return domain;
}
```

---

## Provider Implementations

### ResendProvider

Refactored from current `src/lib/email/resend.ts`:

```typescript
// src/lib/email/providers/resend.ts

export class ResendProvider implements EmailProvider {
  readonly type = "resend" as const;
  private dryRun = false;

  constructor(private apiKey: string) {}

  supportsDryRun(): boolean {
    return true;
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  async send(params: SendParams): Promise<SendResult> {
    // Dry-run mode: validate params but skip Resend API call
    if (this.dryRun || process.env.RESEND_DRY_RUN === "true") {
      return { id: `dry_run_${crypto.randomUUID()}` };
    }

    // Existing retry logic, using this.apiKey instead of env var
    // Resend's Idempotency-Key header provides Layer 2 dedup
    // ... (same implementation as current sendEmail)
  }
}
```

### CloudflareProvider

New provider that calls the CF Email Worker:

```typescript
// src/lib/email/providers/cloudflare.ts

const CF_MAX_RETRIES = 3;
const CF_RETRY_BASE_MS = 500;

export class CloudflareProvider implements EmailProvider {
  readonly type = "cloudflare" as const;
  private dryRun = false;

  constructor(
    private workerUrl: string,
    private apiKey: string,
  ) {}

  supportsDryRun(): boolean {
    return true;
  }

  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  async send(params: SendParams): Promise<SendResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= CF_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = CF_RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      let response: Response;
      try {
        response = await fetch(`${this.workerUrl}/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
            "X-Idempotency-Key": params.idempotencyKey,  // Worker uses this for D1 dedup
            ...(this.dryRun ? { "X-Dry-Run": "true" } : {}),
          },
          body: JSON.stringify({
            from_name: extractName(params.from),
            from_address: extractAddress(params.from),
            to: params.to,
            subject: params.subject,
            html: params.html,
          }),
        });
      } catch (err) {
        // Network error — retryable
        if (attempt < CF_MAX_RETRIES) {
          lastError = err instanceof Error ? err : new Error("CF Worker network error");
          continue;
        }
        throw err;
      }

      const data = await response.json() as {
        status?: "sent" | "in_progress";
        id?: string;
        error?: string;
      };

      // 200 OK — newly sent
      if (response.ok) {
        if (!data.id) {
          throw new Error("CF Worker returned 200 without id");
        }
        return { id: data.id };
      }

      // 409 — Worker distinguishes between two cases via `status` field:
      //   status="sent"        → cached success, return the id
      //   status="in_progress" → concurrent send; wait and retry
      if (response.status === 409) {
        if (data.status === "sent" && data.id) {
          return { id: data.id };
        }
        if (data.status === "in_progress") {
          if (attempt < CF_MAX_RETRIES) {
            lastError = new Error("CF Worker concurrent request");
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw new Error("CF Worker concurrent request did not resolve");
        }
        throw new Error(`CF Worker returned 409 without valid status: ${data.error ?? "unknown"}`);
      }

      // 5xx — retryable
      if (response.status >= 500) {
        if (attempt < CF_MAX_RETRIES) {
          lastError = new Error(`CF Worker error: ${response.status}`);
          continue;
        }
        throw new Error(`CF Worker error: ${response.status} ${data.error ?? ""}`);
      }

      // 4xx — not retryable
      throw new Error(`CF Worker error: ${response.status} ${data.error ?? ""}`);
    }

    throw lastError ?? new Error("CF Worker failed after all retries");
  }
}

function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match ? match[1].trim() : "";
}

function extractAddress(from: string): string {
  const match = from.match(/<(.+)>/);
  return match ? match[1] : from;
}
```

---

## Cloudflare Email Worker

A new, dedicated Worker for sending emails via Cloudflare Email Routing.

### Location

```
worker-email/
  src/index.ts
  package.json
  tsconfig.json
  wrangler.toml
```

> Separate from existing `worker/` (D1 proxy) to maintain single-responsibility.

### wrangler.toml

Mirrors the structure of the existing `worker/wrangler.toml` (production + `[env.test]`) so CF-path E2E tests get their own isolated idempotency table instead of polluting the production one.

```toml
name = "dove-email"
main = "src/index.ts"
compatibility_date = "2025-01-01"

# --- Production ---
[[routes]]
pattern = "dove-email.worker.hexly.ai"
custom_domain = true

[[send_email]]
name = "EMAIL"

# D1 binding for atomic idempotency dedup.
# Reuses the main dove-db for operational simplicity.
[[d1_databases]]
binding = "IDEMPOTENCY_DB"
database_name = "dove-db"
database_id = "2a8b6614-2c00-4891-863e-df80d22a2421"

# API_KEY set via: wrangler secret put API_KEY

# --- Test ---
# Separate route + D1 so E2E runs never touch the production idempotency table.
# Reuses the existing dove-db-test database used by worker/wrangler.toml.
[env.test]

[[env.test.routes]]
pattern = "dove-email-test.worker.hexly.ai"
custom_domain = true

[[env.test.send_email]]
name = "EMAIL"

[[env.test.d1_databases]]
binding = "IDEMPOTENCY_DB"
database_name = "dove-db-test"
database_id = "1adca6ff-076f-45ff-a4d6-a1fdae9397ea"

# API_KEY for the test env set via:
#   wrangler secret put API_KEY --env test
```

The `cf_email_idempotency` table lives in whichever `IDEMPOTENCY_DB` is bound, so:

- Production Worker (`dove-email`) writes to `dove-db`.
- Test Worker (`dove-email-test`) writes to `dove-db-test`.

E2E tests pointing `CloudflareProvider` at `dove-email-test.worker.hexly.ai` therefore get full isolation and can assert on idempotency rows without interfering with real sends.

### Idempotency Table

A dedicated D1 table (lives in the same `dove-db`, owned by the email Worker):

```sql
CREATE TABLE IF NOT EXISTS cf_email_idempotency (
  key TEXT PRIMARY KEY,                   -- The caller-supplied X-Idempotency-Key
  message_id TEXT NOT NULL,               -- Generated cf_xxx ID
  status TEXT NOT NULL,                   -- "sending" | "sent" | "failed"
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cf_email_idempotency_created_at
  ON cf_email_idempotency(created_at);
```

#### Bootstrapping this table

The table must exist in `IDEMPOTENCY_DB` before the Worker serves any traffic. Dove's app-side `initializeSchema()` (in `src/lib/db/schema.ts`) does NOT touch this table — it belongs to the Worker, not the app — so we need a dedicated bootstrap path.

**Chosen approach: Worker-owned self-bootstrap with a deploy-time init endpoint.**

Add an authenticated init endpoint to `worker-email/src/index.ts`, mirroring how the main app exposes `/api/db/init`:

```typescript
// worker-email/src/index.ts
async function handleInit(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await env.IDEMPOTENCY_DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS cf_email_idempotency (
         key TEXT PRIMARY KEY,
         message_id TEXT NOT NULL,
         status TEXT NOT NULL,
         error TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`
    )
    .run();

  await env.IDEMPOTENCY_DB
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_cf_email_idempotency_created_at
         ON cf_email_idempotency(created_at)`
    )
    .run();

  return Response.json({ ok: true });
}

// In the main fetch handler:
if (request.method === "POST" && url.pathname === "/init") {
  return handleInit(request, env);
}
```

Both statements use `IF NOT EXISTS`, so `/init` is idempotent and safe to re-run.

**Deploy ordering:**

```
1. wrangler deploy worker-email                    (prod)
2. curl -X POST -H "X-API-Key: $KEY" \
        https://dove-email.worker.hexly.ai/init

3. wrangler deploy worker-email --env test
4. curl -X POST -H "X-API-Key: $TEST_KEY" \
        https://dove-email-test.worker.hexly.ai/init
```

Both steps are added to the release runbook alongside the existing `bun run release` flow. They should also run in CI before any CF-path E2E executes against a freshly-provisioned test DB, e.g. as part of the E2E fixture setup script.

**Why not auto-init on every request?** Doing the DDL in the hot send path would add latency and needlessly hammer D1. Keeping init behind an explicit admin endpoint is consistent with the main app's `/api/db/init` (session-auth, non-production only at first, explicit trigger).

**Why not co-locate inside `src/lib/db/schema.ts`?** Conceptually clean, but the Worker and the Next.js app are independently deployable. Coupling Worker schema to an app release creates a failure mode where the app upgrades first, the Worker lags, and the Worker fails against the table the app thinks it owns. Worker owns its own schema.

**Why D1 instead of KV:**

- **Atomicity**: `INSERT OR IGNORE` + checking `changes()` gives us atomic check-and-insert. KV's `get`-then-`put` is racy — two concurrent requests can both observe "not found" and both send.
- **No TTL limit**: The guarantee holds for the lifetime of the row. We can optionally prune old rows via a scheduled cleanup (see below), but the dedup window is decoupled from the TTL.
- **Consistency**: D1 gives strong consistency for a single Worker; KV is eventually consistent across regions.

### Worker Implementation

```typescript
// worker-email/src/index.ts

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

interface Env {
  EMAIL: SendEmail;               // CF Email binding
  IDEMPOTENCY_DB: D1Database;     // D1 for dedup
  API_KEY: string;                // Shared secret
}

interface SendRequest {
  from_name: string;
  from_address: string;
  to: string;
  subject: string;
  html: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    // Send email endpoint
    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }

    // Bootstrap the cf_email_idempotency table. See "Bootstrapping this table".
    if (request.method === "POST" && url.pathname === "/init") {
      return handleInit(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleSend(request: Request, env: Env): Promise<Response> {
  // Auth
  const apiKey = request.headers.get("X-API-Key");
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency key (required)
  const idempotencyKey = request.headers.get("X-Idempotency-Key");
  if (!idempotencyKey) {
    return Response.json(
      { error: "Missing X-Idempotency-Key header" },
      { status: 400 }
    );
  }

  // Dry-run mode
  const dryRun = request.headers.get("X-Dry-Run") === "true";

  // Parse body
  let body: SendRequest;
  try {
    body = await request.json() as SendRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate required fields
  if (!body.from_address || !body.to || !body.subject || !body.html) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ATOMIC IDEMPOTENCY CHECK-AND-INSERT (single D1 statement)
  //
  // INSERT OR IGNORE succeeds only if the key doesn't exist.
  // meta.changes === 1 → we claimed the key, proceed to send
  // meta.changes === 0 → someone else claimed it, read the existing record
  // ─────────────────────────────────────────────────────────────────────────
  const messageId = `cf_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const insertResult = await env.IDEMPOTENCY_DB
    .prepare(
      `INSERT OR IGNORE INTO cf_email_idempotency
         (key, message_id, status, created_at, updated_at)
       VALUES (?, ?, 'sending', ?, ?)`
    )
    .bind(idempotencyKey, messageId, now, now)
    .run();

  // We did NOT claim the key — someone already has a record
  if ((insertResult.meta.changes ?? 0) === 0) {
    const existing = await env.IDEMPOTENCY_DB
      .prepare(
        `SELECT message_id, status FROM cf_email_idempotency WHERE key = ?`
      )
      .bind(idempotencyKey)
      .first<{ message_id: string; status: string }>();

    if (!existing) {
      // Extremely rare: row was deleted between INSERT and SELECT
      return Response.json({ error: "idempotency_state_unknown" }, { status: 500 });
    }

    if (existing.status === "sent") {
      // Cached success — return the id with an explicit discriminator
      return Response.json(
        { status: "sent", id: existing.message_id },
        { status: 409 }
      );
    }

    if (existing.status === "sending") {
      // Concurrent in-flight request
      return Response.json(
        { status: "in_progress", error: "Request already in progress" },
        { status: 409 }
      );
    }

    // status === "failed" → reclaim for retry (update this row to 'sending')
    const claim = await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET message_id = ?, status = 'sending', error = NULL, updated_at = ?
         WHERE key = ? AND status = 'failed'`
      )
      .bind(messageId, now, idempotencyKey)
      .run();

    if ((claim.meta.changes ?? 0) === 0) {
      // Another retry already grabbed it — treat as in_progress
      return Response.json(
        { status: "in_progress", error: "Retry contention" },
        { status: 409 }
      );
    }
    // fall through to send with our new messageId
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRY-RUN MODE — skip env.EMAIL.send() but still mark row as "sent"
  // ─────────────────────────────────────────────────────────────────────────
  if (dryRun) {
    const dryRunId = `dry_run_${messageId}`;
    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET message_id = ?, status = 'sent', updated_at = ?
         WHERE key = ?`
      )
      .bind(dryRunId, new Date().toISOString(), idempotencyKey)
      .run();
    return Response.json({ status: "sent", id: dryRunId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEND EMAIL
  // ─────────────────────────────────────────────────────────────────────────
  try {
    const msg = createMimeMessage();
    msg.setSender({ name: body.from_name || "", addr: body.from_address });
    msg.setRecipient(body.to);
    msg.setSubject(body.subject);
    msg.addMessage({ contentType: "text/html", data: body.html });

    const message = new EmailMessage(body.from_address, body.to, msg.asRaw());
    await env.EMAIL.send(message);

    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET status = 'sent', updated_at = ?
         WHERE key = ?`
      )
      .bind(new Date().toISOString(), idempotencyKey)
      .run();

    return Response.json({ status: "sent", id: messageId });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await env.IDEMPOTENCY_DB
      .prepare(
        `UPDATE cf_email_idempotency
           SET status = 'failed', error = ?, updated_at = ?
         WHERE key = ?`
      )
      .bind(errorMessage, new Date().toISOString(), idempotencyKey)
      .run();

    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
```

### Idempotency Flow Diagram

```
Client Request (X-Idempotency-Key: "abc123")
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  INSERT OR IGNORE INTO cf_email_idempotency                   │
│    (key, message_id, status='sending', ...)                   │
│  VALUES ('abc123', 'cf_new', ...)                             │
└───────────────────────────────────────────────────────────────┘
        │
        ├──── changes=1 (we claimed the key)
        │          │
        │          ▼
        │     env.EMAIL.send(message)
        │          │
        │          ├── success → UPDATE status='sent'
        │          │         → 200 { status: "sent", id: "cf_new" }
        │          │
        │          └── failure → UPDATE status='failed'
        │                    → 500 { error }
        │
        └──── changes=0 (key already exists)
                   │
                   ▼
              SELECT existing row
                   │
                   ├── status='sent'     → 409 { status: "sent", id }
                   ├── status='sending'  → 409 { status: "in_progress" }
                   └── status='failed'   → UPDATE status='sending'
                                        → proceed to send
```

### Response Contract

Every response from `POST /send` has a consistent shape so the provider can distinguish cases:

| HTTP | Body | Meaning |
|------|------|---------|
| 200 | `{ status: "sent", id }` | Newly sent — use `id` |
| 409 | `{ status: "sent", id }` | Already sent previously (cached) — use `id` |
| 409 | `{ status: "in_progress", error }` | Concurrent send; caller should retry/wait |
| 400 | `{ error }` | Bad request (missing header, invalid body) |
| 401 | `{ error }` | Bad API key |
| 500 | `{ error }` | Send failed or internal error |

### Optional Cleanup (scheduled)

To prevent unbounded table growth, add a scheduled cleanup (not in MVP):

```typescript
// Scheduled trigger: delete records older than 30 days where status='sent' or 'failed'
async scheduled(event, env) {
  await env.IDEMPOTENCY_DB
    .prepare(
      `DELETE FROM cf_email_idempotency
         WHERE status IN ('sent', 'failed')
         AND created_at < datetime('now', '-30 days')`
    )
    .run();
}
```

This does NOT weaken the idempotency guarantee in practice because Layer 1 (send_logs UNIQUE constraint) remains the authoritative dedup. The CF Worker's Layer 2 dedup is only relevant for retries that arrive while the row still exists.

---

## Send Flow Changes

### Current Flow (Step 10)

```typescript
// Hardcoded to Resend
const fromDomain = process.env.RESEND_FROM_DOMAIN;
const fromAddress = `${project.from_name} <${project.email_prefix}@${fromDomain}>`;
const result = await sendEmail({ from: fromAddress, ... });
```

### New Flow (Step 10)

```typescript
// Dynamic provider selection with legacy fallback
let provider: EmailProvider;
let providerRecord: EmailProviderRecord | null = null;
let providerType: string;

if (project.provider_id) {
  providerRecord = await getEmailProvider(project.provider_id);
  if (!providerRecord) {
    await markSendLogFailed(sendLog.id, "Provider not found");
    return respond(
      errorResponse("provider_not_found", "Configured email provider not found", 500),
      500,
      "provider_not_found",
    );
  }
  provider = createProvider(parseConfig(providerRecord));
  providerType = providerRecord.type;
} else {
  // Legacy fallback: use env vars
  provider = createLegacyProvider();
  providerType = "legacy";
}

const domain = getProviderDomain(providerRecord);
const fromAddress = `${project.from_name} <${project.email_prefix}@${domain}>`;

// Update send_log with provider info BEFORE sending
await updateSendLogProvider(sendLog.id, {
  provider_id: providerRecord?.id ?? null,
  provider_type: providerType,
});

const result = await provider.send({
  from: fromAddress,
  to: recipient.email,
  subject: rendered.subject,
  html: rendered.html,
  idempotencyKey: sendLog.id,
});

// Step 11: Mark as sent, passing providerType so the DB layer can decide
// whether to dual-write resend_id (for "resend"/"legacy") or only
// provider_message_id (for "cloudflare"). See "Public API & UI Contract".
await markSendLogSent(sendLog.id, {
  providerMessageId: result.id,
  providerType,
});

// Step 12: Response (additive — resend_id retained for Resend compat)
return respond(
  NextResponse.json({
    id: sendLog.id,
    resend_id: providerType === "cloudflare" ? null : result.id,
    provider_message_id: result.id,
    provider_type: providerType,
    status: "sent",
  }),
  200,
);
```

---

## Sanitize Layer Updates

The `sanitizeProject()` function must be updated to include `provider_id`:

```typescript
// src/lib/sanitize.ts

export interface SanitizedProject {
  id: string;
  name: string;
  description: string | null;
  email_prefix: string;
  from_name: string;
  quota_daily: number;
  quota_monthly: number;
  provider_id: string | null;  // NEW
  created_at: string;
  updated_at: string;
}

export function sanitizeProject(project: Project): SanitizedProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    email_prefix: project.email_prefix,
    from_name: project.from_name,
    quota_daily: project.quota_daily,
    quota_monthly: project.quota_monthly,
    provider_id: project.provider_id,  // NEW
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}
```

### Provider Sanitization

```typescript
// src/lib/sanitize.ts

export function sanitizeProvider(provider: EmailProviderRecord): SanitizedProvider {
  const config = JSON.parse(provider.config);

  // Mask sensitive fields
  const maskedConfig: Record<string, string> = {};
  if (config.api_key) {
    maskedConfig.api_key = "••••••" + config.api_key.slice(-4);
  }
  if (config.worker_url) {
    maskedConfig.worker_url = config.worker_url;  // URLs are not sensitive
  }

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    domain: provider.domain,
    config: maskedConfig,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  };
}
```

---

## Database Operations

### New File: `src/lib/db/email-providers.ts`

```typescript
export interface EmailProviderRecord {
  id: string;
  name: string;
  type: "resend" | "cloudflare";
  domain: string;
  config: string;  // JSON string
  created_at: string;
  updated_at: string;
}

export async function listEmailProviders(): Promise<EmailProviderRecord[]>;
export async function getEmailProvider(id: string): Promise<EmailProviderRecord | undefined>;
export async function createEmailProvider(data: {...}): Promise<EmailProviderRecord>;
export async function updateEmailProvider(id: string, data: {...}): Promise<EmailProviderRecord | undefined>;
export async function deleteEmailProvider(id: string): Promise<boolean>;

/**
 * Check if any projects reference this provider.
 * Used to block deletion of in-use providers.
 */
export async function countProjectsByProvider(providerId: string): Promise<number>;
```

### Updated: `src/lib/db/projects.ts`

```typescript
export interface Project {
  id: string;
  name: string;
  description: string | null;
  email_prefix: string;
  from_name: string;
  webhook_token: string;
  quota_daily: number;
  quota_monthly: number;
  provider_id: string | null;  // NEW
  created_at: string;
  updated_at: string;
}

// createProject() accepts optional provider_id
// updateProject() accepts optional provider_id (null to unassign)
```

### Updated: `src/lib/db/send-logs.ts`

```typescript
export type ProviderType = "resend" | "cloudflare" | "legacy";

export interface SendLog {
  // ... existing fields ...
  resend_id: string | null;           // UNCHANGED: retained for Resend backward compat
  provider_id: string | null;         // NEW: references email_providers.id (NULL for legacy)
  provider_type: ProviderType | null; // NEW: "resend" | "cloudflare" | "legacy"
  provider_message_id: string | null; // NEW: provider-agnostic successor to resend_id
}

/**
 * Mark a send log as successfully sent.
 *
 * CHANGED: new call shape. The webhook route passes the provider type so the
 * DB layer can decide whether to dual-write resend_id (for "resend"/"legacy")
 * or only provider_message_id (for "cloudflare").
 *
 * Always populates provider_message_id. Also populates resend_id when
 * providerType ∈ {"resend","legacy"} to keep legacy SQL consumers working.
 */
export async function markSendLogSent(
  id: string,
  data: {
    providerMessageId: string;
    providerType: ProviderType;
  },
): Promise<void>;

/**
 * Snapshot which provider handled this send. Called BEFORE provider.send()
 * so the row is already annotated even if the send fails.
 */
export async function updateSendLogProvider(
  id: string,
  data: { provider_id: string | null; provider_type: ProviderType }
): Promise<void>;
```

**Implementation sketch for `markSendLogSent`:**

```typescript
export async function markSendLogSent(
  id: string,
  data: { providerMessageId: string; providerType: ProviderType },
): Promise<void> {
  const now = new Date().toISOString();
  const writeResendId = data.providerType !== "cloudflare";

  await executeD1Query(
    writeResendId
      ? `UPDATE send_logs
           SET status = 'sent',
               resend_id = ?,
               provider_message_id = ?,
               sent_at = ?
         WHERE id = ?`
      : `UPDATE send_logs
           SET status = 'sent',
               provider_message_id = ?,
               sent_at = ?
         WHERE id = ?`,
    writeResendId
      ? [data.providerMessageId, data.providerMessageId, now, id]
      : [data.providerMessageId, now, id],
  );
}
```

**Read-path fallback.** Admin APIs and UI read `provider_message_id` with a fallback to `resend_id` to cover pre-migration rows:

```typescript
// In the serializer used by admin APIs / send-log UI
const messageId = log.provider_message_id ?? log.resend_id ?? null;
```

---

## API Endpoints

### Provider Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | List all providers |
| POST | `/api/providers` | Create provider |
| GET | `/api/providers/[id]` | Get provider details |
| PUT | `/api/providers/[id]` | Update provider |
| DELETE | `/api/providers/[id]` | Delete provider (blocked if in use) |

### Project Provider Assignment

```typescript
// PUT /api/projects/[id]
{
  "provider_id": "prov_abc123"  // or null to use legacy mode
}
```

### Provider Deletion Rules

```typescript
// DELETE /api/providers/[id]
async function deleteProvider(id: string): Promise<Response> {
  const count = await countProjectsByProvider(id);
  if (count > 0) {
    return Response.json(
      {
        error: {
          code: "provider_in_use",
          message: `Cannot delete: ${count} project(s) still use this provider`,
        },
      },
      { status: 409 }
    );
  }

  await deleteEmailProvider(id);
  return Response.json({ success: true });
}
```

---

## Public API & UI Contract for `resend_id`

The current public contract is Resend-specific in three places:

| Location | Current shape | Problem for CF sends |
|----------|---------------|----------------------|
| `POST /api/webhook/[projectId]/send` response | `{ id, resend_id, status }` | `resend_id` is meaningless for CF |
| `SendLog` row returned by admin APIs | `{ ..., resend_id }` | Same |
| Send-log UI detail panel | Shows label "Resend ID" | Misleading for CF sends |

### Decision: Dual-field transition

We do **not** drop `resend_id` in this change. Instead we introduce neutral fields alongside it and update UI/docs to prefer them.

#### Webhook response (`POST /send`)

New shape, additive-only:

```json
{
  "id": "sendlog_xxx",
  "resend_id": "re_xxx_or_null_for_cf",   // LEGACY: kept for Resend sends only; null on CF
  "provider_message_id": "re_xxx_or_cf_xxx",   // NEW: always populated on success
  "provider_type": "resend",               // NEW: "resend" | "cloudflare" | "legacy"
  "status": "sent"
}
```

- Existing Resend callers keep working (they still see `resend_id`).
- CF callers get `provider_message_id` and `provider_type`; `resend_id` is `null`.
- Documentation marks `resend_id` as deprecated in favor of `provider_message_id`.

#### Admin APIs (send-log list/detail)

Admin API responses expose both fields on every row. Frontend code reads `provider_message_id`, falling back to `resend_id` for old rows that were written before the backfill ran.

#### Send-log UI

Replace the single "Resend ID" label with a provider-aware display:

| Row `provider_type` | UI label | Value shown |
|---------------------|----------|-------------|
| `"resend"` or `"legacy"` | "Resend ID" | `provider_message_id` (falls back to `resend_id`) |
| `"cloudflare"` | "Cloudflare Message ID" | `provider_message_id` |
| missing (pre-migration row) | "Provider Message ID" | `resend_id` |

This is a UI-only change in `src/app/send-logs/page.tsx` around the currently-hardcoded "Resend ID" block.

#### Internal code

- `markSendLogSent(id, { providerMessageId, providerType })` writes to BOTH `provider_message_id` AND `resend_id` when `providerType === "resend"` or `"legacy"`, and ONLY to `provider_message_id` when `providerType === "cloudflare"`. This keeps legacy SQL consumers (quota counters, ad-hoc queries) unchanged while populating the neutral column everywhere. See the DB-layer signature in "Database Operations → Updated: `src/lib/db/send-logs.ts`".

#### Removal timeline

`resend_id` stays in the schema indefinitely (no forced drop). A later release MAY:
- Stop writing `resend_id` for new Resend sends once no consumer reads it
- Remove the column in a dedicated cleanup migration

Neither is in scope for this design.

---



```
src/lib/
  email/
    provider.ts           # NEW: Interface + factory + legacy helper
    providers/
      resend.ts           # NEW: ResendProvider class
      cloudflare.ts       # NEW: CloudflareProvider class
      index.ts            # NEW: Re-exports
    render.ts             # Unchanged
    quota.ts              # Unchanged
    resend.ts             # DEPRECATED: Re-exports from providers/resend.ts for compat
  db/
    email-providers.ts    # NEW: Provider CRUD
    projects.ts           # MODIFIED: Add provider_id handling
    send-logs.ts          # MODIFIED: Add provider_id, provider_type
    schema.ts             # MODIFIED: Add email_providers table + migrations
  sanitize.ts             # MODIFIED: Add provider_id to SanitizedProject

src/app/api/
  providers/              # NEW: Provider CRUD endpoints
    route.ts
    [id]/route.ts

worker-email/             # NEW: Dedicated CF Email Worker
  src/index.ts
  package.json
  tsconfig.json
  wrangler.toml
```

---

## Schema Migration (fits existing `initializeSchema()` model)

Dove uses a repeat-safe bootstrap (`src/lib/db/schema.ts`), not a migration runner. All additions must stay idempotent so that `initializeSchema()` can be re-run on fresh installs and existing databases alike.

### Append to `SCHEMA_SQL`

```sql
CREATE TABLE IF NOT EXISTS email_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, domain)
);

CREATE INDEX IF NOT EXISTS idx_email_providers_type ON email_providers(type);
```

### Idempotent `ALTER TABLE ... ADD COLUMN`

D1/SQLite does **not** support `ADD COLUMN IF NOT EXISTS`. Running `ALTER TABLE ... ADD COLUMN` against a column that already exists throws `duplicate column name`.

Solution: a small helper that reads `PRAGMA table_info(...)` and only issues the `ALTER` when missing. Add to `src/lib/db/schema.ts`:

```typescript
/**
 * Idempotent ADD COLUMN — checks table_info before altering.
 * Safe to call repeatedly; no-op if column exists.
 */
async function ensureColumn(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const rows = await executeD1Query<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (rows.some((r) => r.name === column)) return;
  await executeD1Query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```

Then extend `initializeSchema()`:

```typescript
export async function initializeSchema(): Promise<void> {
  // 1. Run all CREATE TABLE / CREATE INDEX statements (existing behavior)
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    await executeD1Query(sql);
  }

  await executeD1Query(PARTIAL_INDEX_SQL);

  // 2. Idempotent column additions for tables that existed before this feature
  await ensureColumn("projects", "provider_id", "TEXT REFERENCES email_providers(id)");
  await ensureColumn("send_logs", "provider_id", "TEXT");
  await ensureColumn("send_logs", "provider_type", "TEXT");
  await ensureColumn("send_logs", "provider_message_id", "TEXT");

  // 3. One-time backfill for rows predating the new columns
  //    Safe to run repeatedly — only updates NULLs.
  await executeD1Query(
    `UPDATE send_logs SET provider_type = 'legacy' WHERE provider_type IS NULL`,
  );
  await executeD1Query(
    `UPDATE send_logs SET provider_message_id = resend_id
       WHERE provider_message_id IS NULL AND resend_id IS NOT NULL`,
  );
}
```

### Fresh-install vs. upgrade

- **Fresh install**: `CREATE TABLE` creates the new columns via definitions added to the existing `CREATE TABLE send_logs (...)` / `CREATE TABLE projects (...)` (see below). `ensureColumn` calls are then no-ops.
- **Existing install**: old tables are missing the columns, `ensureColumn` adds them, backfill runs.

For the fresh-install path, update the `CREATE TABLE` statements in `SCHEMA_SQL` to include the new columns directly:

```sql
CREATE TABLE IF NOT EXISTS projects (
  ...
  provider_id TEXT REFERENCES email_providers(id),  -- NEW
  ...
);

CREATE TABLE IF NOT EXISTS send_logs (
  ...
  provider_id TEXT,                 -- NEW
  provider_type TEXT,               -- NEW
  provider_message_id TEXT,         -- NEW (replaces resend_id long-term; see API contract)
  resend_id TEXT,                   -- Retained for backward compat during transition
  ...
);
```

---

## Testing Strategy

### Unit Tests

- `ResendProvider.send()` — Mock fetch, verify retry logic, verify idempotency header
- `CloudflareProvider.send()` — Mock fetch, verify request format, verify `X-Idempotency-Key` header
- `createProvider()` — Factory returns correct type
- `createLegacyProvider()` — Falls back to env vars

### Integration Tests (L2)

- Provider CRUD API endpoints
- Project provider assignment (including `null` for legacy)
- Send with each provider type (using dry-run mode)
- Provider deletion blocked when in use

### Schema Tests

Update `src/__tests__/schema.test.ts`:

```typescript
test("creates all 6 tables", async () => {
  // ...
  expect(allSql).toContain("CREATE TABLE IF NOT EXISTS email_providers");
  // ... existing 5 tables
});
```

### E2E Tests (L3)

Update tests to support multi-provider:

```typescript
// e2e/api/webhook.test.ts

// Test 1: Legacy mode (provider_id = null, uses RESEND_DRY_RUN=true)
test("sends email via legacy provider", async () => {
  // Existing test, project has no provider_id
});

// Test 2: Resend provider (dry-run mode)
test("sends email via Resend provider", async () => {
  const provider = await createTestProvider({ type: "resend", ... });
  const project = await createTestProject({ provider_id: provider.id });
  // ...
});

// Test 3: CF provider (dry-run mode via X-Dry-Run header)
test("sends email via Cloudflare provider", async () => {
  // Requires CF Email Worker deployed with dry-run support
  const provider = await createTestProvider({ type: "cloudflare", ... });
  const project = await createTestProject({ provider_id: provider.id });
  // ...
});
```

### Dry-Run Contract

All providers MUST support dry-run mode, activated end-to-end through a single env var.

#### Activation: `EMAIL_DRY_RUN`

Introduce a provider-agnostic env var that the webhook route reads once and applies to whichever provider it constructs:

```
EMAIL_DRY_RUN=true   # applies to ALL providers in this process
RESEND_DRY_RUN=true  # legacy alias, still honored for ResendProvider only
```

Webhook wiring (extends Step 10 shown earlier):

```typescript
// src/app/api/webhook/[projectId]/send/route.ts

const provider = providerRecord
  ? createProvider(parseConfig(providerRecord))
  : createLegacyProvider();

// Provider-agnostic dry-run toggle applied at the webhook layer,
// so CF and Resend behave identically under test.
if (process.env.EMAIL_DRY_RUN === "true") {
  provider.setDryRun(true);
}
```

#### Provider behavior when `setDryRun(true)`

| Provider | Dry-Run Mechanism |
|----------|-------------------|
| ResendProvider | Skips `fetch()` to Resend API, returns `{ id: "dry_run_<uuid>" }` |
| CloudflareProvider | Sends `X-Dry-Run: true` header to CF Worker |
| CF Email Worker | Honors `X-Dry-Run` header: skips `env.EMAIL.send()`, still writes the idempotency row to D1 so retry semantics stay observable |

Legacy env var compatibility:

- `ResendProvider.send()` treats `RESEND_DRY_RUN === "true"` as equivalent to `setDryRun(true)`.
- `.env.test` is updated to set `EMAIL_DRY_RUN=true` (and keeps `RESEND_DRY_RUN=true` for now to avoid breaking anything that reads it directly).

#### Existing E2E (`RESEND_DRY_RUN=true` in `.env.test`)

No behavior change for the legacy Resend path — `RESEND_DRY_RUN` remains honored by `ResendProvider`. Once `EMAIL_DRY_RUN` is in place, new CF tests key off that variable and the legacy projects (no `provider_id`) continue to use `RESEND_DRY_RUN`.

---

## Rollback Plan

### Code-Level Rollback

The legacy fallback (`provider_id = NULL → use env vars`) ensures:
- Existing projects continue working without any migration
- New code can be deployed incrementally
- If issues arise, simply don't create any `email_providers` records

### Schema-Level Rollback

All new columns are nullable and have no NOT NULL constraints:
- `projects.provider_id` — `NULL` means legacy mode
- `send_logs.provider_id` — `NULL` for historical logs
- `send_logs.provider_type` — Backfilled to `"legacy"`

### Worker Rollback

CF Email Worker is independent:
- If Worker fails, only CF-configured projects are affected
- Resend and legacy paths continue working
- Can disable CF Worker without code changes (just don't create CF providers)

---

## Security Considerations

### Credential Storage

- API keys stored in `email_providers.config` JSON
- D1 encrypts data at rest
- Never exposed to frontend (sanitized before response)

### API Key Display

Frontend sees only masked keys: `"••••••xxxx"` (last 4 chars)

### Worker Authentication

- `X-API-Key` header required for all CF Worker requests
- Key stored as Cloudflare secret (`wrangler secret put API_KEY`)

---

## Open Questions (Resolved)

1. **Provider deletion with active projects**
   - **Decision:** Block deletion. Return 409 with count of affected projects.

2. **Quota per-provider vs per-project**
   - **Decision:** Keep project-level only. Provider-level limits add complexity without clear benefit.

3. **Dry-run mode per-provider**
   - **Decision:** Yes, required. All providers must implement `supportsDryRun()` and `setDryRun()`. CF Worker checks `X-Dry-Run` header.

4. **`provider_id = NULL` behavior**
   - **Decision:** Fallback to legacy mode (env-var-based Resend). This ensures backward compatibility during rollout.

5. **Send log provider tracking**
   - **Decision:** Snapshot `provider_id` and `provider_type` at send time. Enables filtering and auditing even after project reassignment.

---

## Implementation Progress

Atomic commits tracking the rollout of this design.

| # | Commit | Status |
|---|--------|--------|
| C1 | Schema — add email_providers + columns + ensureColumn helper | ✅ done |
| C2 | DB layer — email-providers.ts + projects.ts + send-logs.ts | ✅ done |
| C3 | Provider layer — interface + Resend + Cloudflare + factory | ✅ done |
| C4 | Sanitize layer — provider_id + sanitizeProvider | ✅ done |
| C5 | Webhook /send — provider dispatch, dry-run toggle, new response | ✅ done |
| C6 | Provider CRUD API — /api/providers | ⏳ pending |
| C7 | Project API — accept provider_id | ⏳ pending |
| C8 | worker-email — dedicated CF Email Worker | ⏳ pending |
