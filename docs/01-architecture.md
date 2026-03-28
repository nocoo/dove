# 01 — Architecture

Dove is a self-hosted email relay service. Personal projects send emails via webhook; Dove manages templates, recipients, quotas, and logs, forwarding to Resend API.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Same as backy |
| Framework | Next.js 16 (App Router) | Standalone output |
| Language | TypeScript (strict) | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Database | Cloudflare D1 via Worker proxy | Worker binds D1 natively; Railway calls Worker over HTTPS |
| DB Proxy | Cloudflare Worker | Thin SQL proxy with API key auth, deployed via Wrangler |
| Auth | NextAuth v5 (Google OAuth) | Email whitelist via `ALLOWED_EMAILS` |
| UI | Tailwind CSS v4 + shadcn/ui | Basalt design system (new-york variant) |
| Validation | Zod v4 | Request body validation |
| Email | Resend API | `POST https://api.resend.com/emails` |
| IDs | nanoid | 21-char IDs, 48-char webhook tokens |
| Deployment | Railway (app) + Cloudflare (worker) | App on Railway port 7046; Worker on CF edge |

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Dove App (Next.js on Railway)               │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Dashboard │  │ Projects  │  │Templates │  │   Logs    │  │
│  │  (stats)  │  │  (CRUD)   │  │  (CRUD)  │  │  (view)   │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │              │         │
│  ┌────┴──────────────┴──────────────┴──────────────┴─────┐  │
│  │                    REST API Layer                      │  │
│  │  Session auth (UI)  │  Bearer token auth (webhooks)   │  │
│  └────────────────────────────┬──────────────────────────┘  │
│                               │                             │
│  ┌────────────────────────────┴──────────────────────────┐  │
│  │                   Business Logic                      │  │
│  │  Quota check → Recipient verify → Template render →   │  │
│  │  Resend send → Log result                             │  │
│  └───────────┬───────────────────────────┬───────────────┘  │
│              │                           │                  │
│  ┌───────────┴───────────┐  ┌────────────┴───────────────┐  │
│  │   D1 Proxy Client     │  │      Resend API            │  │
│  │   (HTTPS → Worker)    │  │  POST /emails              │  │
│  └───────────┬───────────┘  └────────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────┘
               │ HTTPS + API key
               ▼
┌─────────────────────────────┐
│  Dove Worker (Cloudflare)   │
│  ─────────────────────────  │
│  POST /query                │
│  Auth: X-API-Key header     │
│  Body: { sql, params }      │
│  → D1 native binding        │
│  → Returns JSON rows        │
└──────────────┬──────────────┘
               │ native binding
               ▼
┌─────────────────────────────┐
│       Cloudflare D1         │
└─────────────────────────────┘

External callers (personal projects):

  curl -X POST $DOVE_URL/api/webhook/{projectId}/send \
    -H "Authorization: Bearer <token>" \
    -d '{"template":"welcome","to":"rid_xxx","variables":{...}}'
```

## Database Schema

5 tables. All IDs are nanoid (21-char). All timestamps are stored as UTC strings in the format `YYYY-MM-DDTHH:mm:ss.sssZ` (e.g. `2026-03-28T08:30:00.000Z`). No timezone offsets — always trailing `Z`. This is critical because quota counting relies on string comparison with SQLite's `date('now', ...)` which operates in UTC.

### `projects`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `name` | TEXT | NOT NULL | Project display name |
| `description` | TEXT | | Optional description |
| `email_prefix` | TEXT | NOT NULL | Sender prefix, e.g. `noreply` |
| `from_name` | TEXT | NOT NULL | Sender display name, e.g. `Backy Alerts` |
| `webhook_token` | TEXT | NOT NULL, UNIQUE | 48-char nanoid for Bearer auth |
| `quota_daily` | INTEGER | NOT NULL, DEFAULT 100 | Soft limit: max sends per day (best-effort) |
| `quota_monthly` | INTEGER | NOT NULL, DEFAULT 1000 | Soft limit: max sends per month (best-effort) |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

Sender address is constructed as: `{from_name} <{email_prefix}@{RESEND_FROM_DOMAIN}>`.
For example, with `from_name = "Backy Alerts"`, `email_prefix = "noreply"`, `RESEND_FROM_DOMAIN = "mail.example.com"`:
→ `Backy Alerts <noreply@mail.example.com>`

### `recipients`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `project_id` | TEXT | NOT NULL, FK → projects(id) CASCADE | Owning project |
| `name` | TEXT | NOT NULL | Display name |
| `email` | TEXT | NOT NULL | Email address |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

UNIQUE constraint on `(project_id, email)` — no duplicate emails per project.

**Email normalization**: All email addresses are normalized on write and on lookup: `value.trim().toLowerCase()`. This ensures `User@Example.com` and `user@example.com` resolve to the same recipient. Normalization is applied in:
- `POST /api/recipients` (create) and `PUT /api/recipients/[id]` (update)
- Webhook send flow step 5 (recipient lookup by email)

### `templates`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `project_id` | TEXT | NOT NULL, FK → projects(id) CASCADE | Owning project |
| `name` | TEXT | NOT NULL | Display name |
| `slug` | TEXT | NOT NULL | URL-safe identifier (e.g. `welcome`) |
| `subject` | TEXT | NOT NULL | Email subject, supports `{{var}}` |
| `body_markdown` | TEXT | NOT NULL | Markdown body, supports `{{var}}` |
| `variables` | TEXT | NOT NULL, DEFAULT '[]' | JSON array of variable declarations |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

UNIQUE constraint on `(project_id, slug)` — no duplicate slugs per project.

#### Variable Declaration Schema

```typescript
interface TemplateVariable {
  name: string;       // Variable name, used as {{name}} in template
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string;   // Always stored as string; coerced to `type` at validation time
}
```

**Type coercion rules**: All `default` values and all webhook-supplied `variables` values are accepted as strings and coerced at validation time:
- `"string"` — used as-is
- `"number"` — must pass `Number()` without `NaN`; rendered as the numeric string
- `"boolean"` — must be `"true"` or `"false"` (case-insensitive); rendered as `"true"` / `"false"`

This "string-in, coerce-on-validate" approach keeps the JSON schema simple (all values are strings in storage and transport) while still enforcing type correctness before rendering.

Stored as JSON string in `variables` column. Example:

```json
[
  { "name": "username", "type": "string", "required": true },
  { "name": "code", "type": "string", "required": true },
  { "name": "expire_minutes", "type": "number", "required": false, "default": "30" }
]
```

### `send_logs`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `project_id` | TEXT | NOT NULL, FK → projects(id) CASCADE | |
| `idempotency_key` | TEXT | | Caller-provided dedup key (nullable) |
| `payload_hash` | TEXT | | SHA-256 of canonical request payload (set when idempotency_key is present) |
| `template_id` | TEXT | FK → templates(id) ON DELETE SET NULL | Template used (set null when template deleted) |
| `recipient_id` | TEXT | FK → recipients(id) ON DELETE SET NULL | Recipient record (set null when recipient deleted) |
| `to_email` | TEXT | NOT NULL | Actual email address sent to (denormalized) |
| `subject` | TEXT | NOT NULL | Rendered subject (denormalized) |
| `status` | TEXT | NOT NULL | `sending` / `sent` / `failed` |
| `resend_id` | TEXT | | Resend message UUID on success |
| `error_message` | TEXT | | Error details on failure |
| `created_at` | TEXT | NOT NULL | When the send_log was created (pre-log) |
| `sent_at` | TEXT | | When Resend confirmed delivery (set on status → `sent`) |

Denormalized `to_email` and `subject` ensure logs remain readable even if recipient/template is deleted.

UNIQUE index on `(project_id, idempotency_key)` WHERE `idempotency_key IS NOT NULL` — enforces caller-level dedup. Rows without a key are exempt (no dedup).

### `webhook_logs`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `project_id` | TEXT | NOT NULL, FK → projects(id) CASCADE | |
| `method` | TEXT | NOT NULL | HTTP method |
| `path` | TEXT | NOT NULL | Request path |
| `status_code` | INTEGER | NOT NULL | Response status code |
| `error_code` | TEXT | | Structured error code |
| `error_message` | TEXT | | Human-readable error |
| `duration_ms` | INTEGER | | Request processing time |
| `ip` | TEXT | | Client IP |
| `user_agent` | TEXT | | Client User-Agent |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

Webhook logs are **fire-and-forget observability logs** — written asynchronously (`void createWebhookLog(...)`, errors swallowed), never blocking the response. As a consequence:
- Logs **may be lost** under D1 transient failures or process crashes
- They are suitable for debugging and traffic monitoring, **not** for strong-consistency auditing
- For authoritative send history, use `send_logs` (written synchronously before responding)

## Project Structure

```
dove/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── projects/route.ts
│   │   │   ├── projects/[id]/route.ts
│   │   │   ├── projects/[id]/token/route.ts
│   │   │   ├── recipients/route.ts
│   │   │   ├── recipients/[id]/route.ts
│   │   │   ├── templates/route.ts
│   │   │   ├── templates/[id]/route.ts
│   │   │   ├── templates/[id]/preview/route.ts
│   │   │   ├── send-logs/route.ts
│   │   │   ├── webhook-logs/route.ts
│   │   │   ├── stats/route.ts
│   │   │   ├── stats/charts/route.ts
│   │   │   ├── webhook/[projectId]/route.ts       # HEAD — health check
│   │   │   ├── webhook/[projectId]/send/route.ts  # POST — send email
│   │   │   ├── webhook/[projectId]/templates/route.ts  # GET — list templates
│   │   │   ├── db/init/route.ts     # Session auth + non-production only
│   │   │   └── live/route.ts
│   │   ├── page.tsx                # Dashboard
│   │   ├── layout.tsx              # Root layout
│   │   ├── login/page.tsx
│   │   ├── projects/               # Project list + detail
│   │   ├── templates/              # Template list + editor
│   │   ├── send-logs/              # Send log viewer
│   │   └── webhook-logs/           # Webhook log viewer
│   ├── auth.ts                     # NextAuth v5 config
│   ├── proxy.ts                    # Auth proxy (Next.js 16)
│   ├── components/
│   │   ├── layout/                 # AppShell, Sidebar, Breadcrumbs
│   │   ├── charts/                 # Dashboard charts
│   │   ├── ui/                     # shadcn/ui primitives
│   │   └── template-editor.tsx     # Markdown editor + preview
│   ├── hooks/
│   │   └── use-is-mobile.ts
│   └── lib/
│       ├── db/
│       │   ├── d1-client.ts        # D1 proxy client (HTTPS → Worker)
│       │   ├── schema.ts           # CREATE TABLE + migrations
│       │   ├── projects.ts         # Project CRUD
│       │   ├── recipients.ts       # Recipient CRUD
│       │   ├── templates.ts        # Template CRUD
│       │   ├── send-logs.ts        # Send log queries
│       │   └── webhook-logs.ts     # Webhook log queries
│       ├── email/
│       │   ├── resend.ts           # Resend API client
│       │   ├── render.ts           # Markdown → HTML + variable substitution
│       │   └── quota.ts            # Daily/monthly quota checking
│       ├── id.ts                   # nanoid generators
│       ├── hosts.ts                # x-forwarded-host allowlist
│       ├── sanitize.ts             # Strip webhook_token from responses
│       └── utils.ts                # cn() tailwind merge
├── src/__tests__/                  # L1 unit tests
├── e2e/api/                        # L2 API E2E tests
├── e2e/bdd/                        # L3 Playwright BDD tests
├── scripts/
│   ├── check-coverage.ts           # 90% gate
│   ├── run-e2e.ts                  # L2 server lifecycle
│   ├── gate-security.ts            # G2: osv-scanner + gitleaks
│   └── release.ts                  # SemVer + CHANGELOG + GitHub release
├── Dockerfile                      # 3-stage: deps → build → runtime
├── railway.json
├── worker/                         # Cloudflare Worker (D1 proxy)
│   ├── src/index.ts                # Worker entry point
│   ├── wrangler.toml               # D1 binding + env config
│   ├── package.json
│   └── tsconfig.json
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── CLAUDE.md
└── CHANGELOG.md
```

## API Design

### Session-Authenticated APIs (Web UI)

| Route | Methods | Description |
|---|---|---|
| `GET /api/projects` | GET | List all projects |
| `POST /api/projects` | POST | Create project |
| `GET /api/projects/[id]` | GET | Get project detail |
| `PUT /api/projects/[id]` | PUT | Update project |
| `DELETE /api/projects/[id]` | DELETE | Delete project (cascades) |
| `POST /api/projects/[id]/token` | POST | Regenerate webhook token (returns **one-time plaintext**) |
| `GET /api/recipients?projectId=` | GET | List recipients for project |
| `POST /api/recipients` | POST | Add recipient |
| `PUT /api/recipients/[id]` | PUT | Update recipient |
| `DELETE /api/recipients/[id]` | DELETE | Remove recipient |
| `GET /api/templates?projectId=` | GET | List templates for project |
| `POST /api/templates` | POST | Create template |
| `GET /api/templates/[id]` | GET | Get template detail |
| `PUT /api/templates/[id]` | PUT | Update template |
| `DELETE /api/templates/[id]` | DELETE | Delete template |
| `POST /api/templates/[id]/preview` | POST | Render template with sample variables |
| `GET /api/send-logs?projectId=` | GET | List send logs (paginated) |
| `GET /api/webhook-logs?projectId=` | GET | List webhook logs (paginated) |
| `GET /api/stats` | GET | Dashboard summary stats |
| `GET /api/stats/charts` | GET | Chart data (sends over time) |

### Webhook APIs (Bearer Token Auth)

| Route | Method | Description |
|---|---|---|
| `HEAD /api/webhook/[projectId]` | HEAD | Health check (verify token) |
| `POST /api/webhook/[projectId]/send` | POST | **Core: send email** |
| `GET /api/webhook/[projectId]/templates` | GET | List available templates |

### Public APIs

| Route | Method | Description |
|---|---|---|
| `GET /api/live` | GET | Health check (D1 ping + version) |

## Webhook Send Flow

```
POST /api/webhook/{projectId}/send
Authorization: Bearer <webhook_token>
Content-Type: application/json

{
  "template": "welcome",           // template slug (required)
  "to": "rec_xxx",                 // recipient ID or whitelisted email (required, see below)
  "idempotency_key": "order_12345_welcome",  // caller-provided dedup key (optional but recommended)
  "variables": {                   // template variables (optional)
    "username": "Alice",
    "code": "123456"
  }
}
```

**Recipient whitelist enforcement**: The `to` field accepts either a recipient ID (e.g. `rec_xxx`) or an email address (e.g. `user@example.com`). In both cases, the value **must** resolve to an existing entry in the project's recipient list. Sending to an email that has not been registered as a recipient for this project will return 404 `recipient_not_found`. There is no "direct send to arbitrary address" mode — every outbound email must target a pre-registered recipient.

**Caller-side idempotency**: The `idempotency_key` field is optional but strongly recommended. When provided, Dove checks for an existing `send_log` with the same `(project_id, idempotency_key)` combination:

**Payload fingerprint enforcement**: An idempotency key is permanently bound to its request payload. On first use, a SHA-256 hash of the canonical payload (`JSON.stringify({ template, to, variables })` with sorted keys) is stored in `send_logs.payload_hash`. On subsequent requests with the same key, the incoming payload hash is compared against the stored one. If they differ → return 422 `idempotency_payload_mismatch`. This prevents silent semantic conflicts where the same key carries different intent.

Dedup behavior (assuming payload matches):
- If a matching log exists with status `sent` → return the cached result immediately (200, no re-send)
- If a matching log exists with status `failed` → reuse the existing send_log record, re-run from step 4 (quota check → recipient → template → validate → render → reset record to `sending` → Resend call → update). Payload fingerprint guarantees identical input so re-rendering produces the same result. The original `send_log.id` is preserved as the Resend Idempotency-Key.
- If a matching log exists with status `sending` → return 409 `send_in_progress`

If the caller needs to change the payload after a failure (e.g. fix a typo in template variables), they must use a **new idempotency_key**. The old failed record remains as-is.

This protects against the scenario where the caller retries a webhook request due to timeout/disconnect, but Dove had already accepted and sent the email. The key is scoped per-project and has no expiry (dedup is permanent within `send_logs`).

When `idempotency_key` is omitted, Dove does not perform caller-level dedup — each request is treated as a new send intent.

### Processing Pipeline

```
1. Auth          → Validate Bearer token, match projectId  → 401/403
2. Parse         → Validate request body (Zod)             → 400
3. Dedup         → If idempotency_key provided, check      → 200 (cached) /
                   (project_id, key) in send_logs:            409 / 422
                   found → verify payload_hash matches;
                   mismatch → 422 idempotency_payload_mismatch;
                   sent → return cached; sending → 409;
                   failed → reuse record, continue to step 4
4. Quota check   → Best-effort soft limit (see Quota System) → 429
5. Recipient     → Resolve "to" against project's recipient  → 404
                   whitelist (by ID or email); unlisted = reject
6. Template      → Find by slug in project                 → 404
7. Validate vars → Check variables against template schema  → 422
8. Render        → Replace {{var}} in subject + body,      →
                   convert Markdown → HTML
9. Pre-log       → Create send_log with status "sending"   →
                   (or reset existing failed record: set
                    status to "sending", update to_email/
                    subject with re-rendered values,
                    clear error_message)
                   (the log ID becomes Resend Idempotency-Key)
10. Send         → POST to Resend API with Idempotency-Key → 502 on failure
11. Update log   → Set status to sent/failed, set sent_at  →
                   (sync, authoritative)
                   Write webhook_log (fire-and-forget, may be lost)
12. Response     → { id, resend_id, status }               → 200
```

### Success Response

```json
{
  "id": "send_log_id",
  "resend_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
  "status": "sent"
}
```

### Error Codes

| Code | HTTP | Description |
|---|---|---|
| `auth_missing` | 401 | No Authorization header |
| `auth_invalid` | 403 | Token mismatch or project not found |
| `body_invalid` | 400 | Request body fails Zod validation |
| `send_in_progress` | 409 | Duplicate idempotency_key with status `sending` |
| `idempotency_payload_mismatch` | 422 | Same idempotency_key but different request payload |
| `quota_daily_exceeded` | 429 | Daily send limit reached |
| `quota_monthly_exceeded` | 429 | Monthly send limit reached |
| `recipient_not_found` | 404 | `to` not in project's recipient whitelist (by ID or email) |
| `template_not_found` | 404 | Template slug not found in project |
| `variables_invalid` | 422 | Missing required vars or type mismatch |
| `resend_failed` | 502 | Resend API returned error |
| `internal_error` | 500 | Unexpected server error |

## Template Rendering

### Variable Substitution

Simple `{{variable_name}}` syntax. No nesting, no logic, no loops.

```markdown
# Welcome, {{username}}!

Your verification code is **{{code}}**.

This code expires in {{expire_minutes}} minutes.
```

### Rendering Pipeline

1. **Validate** — Check all required variables are present, types match
2. **Substitute** — Replace all `{{var}}` with provided values (HTML-escaped)
3. **Convert** — Markdown → HTML (using a lightweight library like `marked`)
4. **Wrap** — Insert into a minimal responsive email HTML wrapper

### HTML Escaping

All variable values are HTML-escaped before substitution to prevent XSS:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`

## Quota System

Quotas are **soft limits (best-effort)**. Each send request performs a near-real-time count check before sending. Under concurrent requests, brief over-delivery is possible — the authoritative count is always `send_logs` with `status = 'sent'`. This is acceptable for a personal relay service; there is no distributed lock or transactional guarantee.

### Time Boundary

All quota windows use **UTC**:
- **Daily quota** resets at `UTC 00:00` each day
- **Monthly quota** resets at `UTC 00:00` on the 1st of each month

### Counting

Quota is counted against `sent_at` (the moment Resend confirmed delivery), not `created_at` (the moment the send_log was pre-created). This avoids cross-UTC-boundary misattribution when the pre-log and actual send straddle midnight.

```sql
-- Daily count (UTC boundary, by actual send time)
SELECT COUNT(*) FROM send_logs
WHERE project_id = ? AND status = 'sent'
AND sent_at >= date('now', 'start of day')

-- Monthly count (UTC boundary, by actual send time)
SELECT COUNT(*) FROM send_logs
WHERE project_id = ? AND status = 'sent'
AND sent_at >= date('now', 'start of month')
```

Only `sent` status counts toward quota. Failed sends do not consume quota.

### Default Limits

| Quota | Default | Configurable |
|---|---|---|
| Daily | 100 | Per project, via UI |
| Monthly | 1000 | Per project, via UI |

## Resend Integration

### Client Design (`src/lib/email/resend.ts`)

```typescript
interface SendEmailParams {
  from: string;        // "{from_name} <{prefix}@{RESEND_FROM_DOMAIN}>"
  to: string;          // Recipient email
  subject: string;     // Rendered subject
  html: string;        // Rendered HTML
  idempotencyKey: string;  // Unique key to prevent duplicate sends
}

interface SendEmailResult {
  id: string;          // Resend message UUID
}

async function sendEmail(params: SendEmailParams): Promise<SendEmailResult>
```

- Direct `fetch()` call to `https://api.resend.com/emails`
- Auth: `Authorization: Bearer ${RESEND_API_KEY}`
- **Idempotency (two layers)**:
  - **Layer 1 — Caller dedup**: If the webhook request includes `idempotency_key`, Dove checks `(project_id, idempotency_key)` in `send_logs` before processing. Duplicate `sent` results are returned from cache; no Resend call is made.
  - **Layer 2 — Resend dedup**: Every Resend API call includes `Idempotency-Key: ${send_log_id}`. Since the send_log record is created (with status `sending`) *before* calling Resend, retries within the same processing flow reuse the same key. Resend deduplicates within a 24-hour window, preventing duplicate delivery even if the first request succeeded but the response was lost.
- Retry: 3 attempts with exponential backoff (500ms → 1000ms → 2000ms) on 5xx only
- No retry on 4xx (client errors are not transient)
- On 409 `concurrent_idempotent_requests`: wait 1s and retry (original request still in flight)

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `RESEND_API_KEY` | Resend API key | `re_xxxxxxxxx` |
| `RESEND_FROM_DOMAIN` | Verified sender domain | `mail.example.com` |

## D1 Worker Proxy

The Dove app (on Railway) does not connect to Cloudflare D1 directly. Instead, a thin Cloudflare Worker acts as a SQL proxy, binding D1 natively and exposing a single HTTPS endpoint. This avoids the Cloudflare REST API's per-request overhead and auth complexity, and keeps the D1 credentials inside Cloudflare's network.

### Worker API

Single endpoint:

```
POST https://<worker-domain>/query
X-API-Key: <shared secret>
Content-Type: application/json

{
  "sql": "SELECT * FROM projects WHERE id = ?",
  "params": ["proj_abc123"]
}
```

**Response (success)**:

```json
{
  "success": true,
  "results": [ { "id": "proj_abc123", "name": "Backy", ... } ],
  "meta": {
    "changes": 0,
    "last_row_id": 0,
    "rows_read": 1,
    "rows_written": 0
  }
}
```

**Response (error)**:

```json
{
  "success": false,
  "error": "D1_ERROR: UNIQUE constraint failed: projects.webhook_token"
}
```

### Worker Implementation (`worker/src/index.ts`)

```typescript
interface Env {
  DB: D1Database;       // D1 native binding
  API_KEY: string;      // Shared secret (Cloudflare env var)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Only POST /query
    // 2. Validate X-API-Key header against env.API_KEY
    // 3. Parse { sql, params } from body
    // 4. Execute env.DB.prepare(sql).bind(...params).all()
    // 5. Return { success, results, meta } or { success: false, error }
  }
}
```

The worker is deliberately minimal — no routing framework, no ORM, no business logic. It is a pure SQL pass-through with auth.

### D1 Proxy Client (`src/lib/db/d1-client.ts`)

On the Railway side, the client replaces backy's direct D1 REST calls with calls to the Worker:

```typescript
async function executeD1Query<T>(sql: string, params?: unknown[]): Promise<T[]>
```

- Calls `POST ${D1_WORKER_URL}/query` with `X-API-Key: ${D1_WORKER_API_KEY}`
- Retry: 3 attempts with exponential backoff (500ms → 1000ms → 2000ms) on 5xx / network errors
- Parses `results` array from response, returns as `T[]`
- Throws on `success: false` with the error message

### Worker Deployment

- Deployed via `wrangler deploy` from the `worker/` directory
- D1 binding configured in `wrangler.toml`
- `API_KEY` set as a Cloudflare Worker secret (`wrangler secret put API_KEY`)

### `wrangler.toml`

```toml
name = "dove-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "dove"
database_id = "<from cloudflare dashboard>"
```

## Auth & Security

### Authentication (same pattern as backy)

- **Web UI**: NextAuth v5, Google OAuth, `ALLOWED_EMAILS` whitelist
- **Webhooks**: Bearer token (48-char nanoid) per project
- **Health check** (`/api/live`): Public, no auth

### Proxy (`src/proxy.ts`)

Public routes (no auth required):
- `/api/auth/*`
- `/api/live`
- `/api/webhook/*`

### Database Initialization (`/api/db/init`)

**NOT a public route.** Requires session auth (admin login) and is further gated:
- `NODE_ENV === 'production'` → returns 403 unconditionally, regardless of auth status
- Only accessible when `NODE_ENV` is `development` or `test`
- In production, schema initialization must be performed via CLI or deployment script before the app starts

### Sanitization

`sanitizeProject()` strips `webhook_token` from all API responses using field allowlisting (not deletion).

**Exception**: `POST /api/projects/[id]/token` (token regeneration) returns the new token in plaintext exactly once:
```json
{ "webhook_token": "new_48char_token_here" }
```
This is the **only** opportunity to copy the token. Subsequent `GET /api/projects/[id]` responses will have `webhook_token` stripped. The UI must display the token with a copy button immediately after regeneration, with a clear "this will not be shown again" warning.

### Environment Variables (Full List)

**Dove App (Railway)**:

| Variable | Required | Description |
|---|---|---|
| `D1_WORKER_URL` | Yes | Worker endpoint URL (e.g. `https://dove-worker.xxx.workers.dev`) |
| `D1_WORKER_API_KEY` | Yes | Shared secret for Worker auth |
| `RESEND_API_KEY` | Yes | Resend API key |
| `RESEND_FROM_DOMAIN` | Yes | Verified sender domain |
| `AUTH_SECRET` | Yes | NextAuth secret |
| `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
| `ALLOWED_EMAILS` | Yes | Comma-separated allowed emails |
| `ALLOWED_HOSTS` | No | x-forwarded-host allowlist |
| `USE_SECURE_COOKIES` | No | Force secure cookies |
| `E2E_SKIP_AUTH` | No | Skip auth in E2E tests |
| `PORT` | No | Override default port (7046) |

**Dove Worker (Cloudflare)**:

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | Yes | Shared secret (must match `D1_WORKER_API_KEY` on Railway side) |
| D1 binding `DB` | Yes | Configured in `wrangler.toml`, not an env var |

## Pages & UI

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Send stats, quota usage gauges, recent activity |
| Projects | `/projects` | Project list with send counts, quota bars |
| Project Detail | `/projects/[id]` | Settings, token management, recipients, templates |
| Templates | `/templates` | Template list grouped by project |
| Template Editor | `/templates/[id]` | Markdown editor with live preview, variable schema editor |
| Send Logs | `/send-logs` | Paginated table with status filter, search |
| Webhook Logs | `/webhook-logs` | Paginated table, similar to backy |
| Login | `/login` | Google OAuth sign-in |

## Port Convention

| Purpose | Port |
|---|---|
| Dev | 7046 |
| L2 E2E | 17046 |
| L3 BDD | 27046 |

## Atomic Commits Plan

The project will be built in these commit phases:

### Phase 1 — Scaffold
1. ✅ Initialize project (package.json, tsconfig, next.config, eslint, Dockerfile, railway.json)
2. ✅ Cloudflare Worker setup (worker/, wrangler.toml, D1 binding, API key auth)
3. ✅ D1 proxy client (`src/lib/db/d1-client.ts` — calls Worker instead of D1 REST)
4. ✅ Copy and adapt ID generation, host validation from backy
5. ✅ Set up NextAuth v5 (auth.ts, proxy.ts, login page)
6. ✅ Set up Tailwind + shadcn/ui base components
7. ✅ Create AppShell (sidebar, layout, theme toggle)

### Phase 2 — Data Layer
8. ✅ Database schema (CREATE TABLE, migrations)
9. ✅ Projects CRUD (`src/lib/db/projects.ts`)
10. ✅ Recipients CRUD (`src/lib/db/recipients.ts`)
11. ✅ Templates CRUD (`src/lib/db/templates.ts`)
12. ✅ Send logs queries (`src/lib/db/send-logs.ts`)
13. ✅ Webhook logs queries (`src/lib/db/webhook-logs.ts`)

### Phase 3 — Business Logic
14. ✅ Template rendering engine (variable substitution + Markdown → HTML)
15. ✅ Resend API client
16. ✅ Quota checking
17. ✅ Sanitization (strip webhook_token)

### Phase 4 — API Routes
18. ✅ Project API routes (CRUD + token regeneration)
19. ✅ Recipient API routes (CRUD)
20. ✅ Template API routes (CRUD + preview)
21. ✅ Send log / webhook log API routes (list, paginated)
22. ✅ Stats API routes (dashboard data + charts)
23. ✅ Webhook routes (HEAD health check, POST send, GET templates)
24. ✅ Health check (`/api/live`), DB init (`/api/db/init` — non-production only, session auth)

### Phase 5 — UI
25. ✅ Dashboard page (stats cards, quota gauges, charts)
26. ✅ Projects page (list + detail with settings)
27. ✅ Template editor page (Markdown editor + live preview + variable schema)
28. ✅ Send logs page (table + filters)
29. ✅ Webhook logs page (table)

### Phase 6 — Quality
30. ✅ L1 unit tests (90%+ coverage)
31. ✅ L2 API E2E tests
32. ✅ G1 static analysis (tsc + eslint strict)
33. ✅ G2 security (osv-scanner + gitleaks)
34. ✅ Husky hooks (pre-commit: G1 + L1, pre-push: L2 + G2)

## Testing Strategy

| Layer | Scope | Trigger | Tools |
|---|---|---|---|
| L1 | Unit tests (lib/, components) | pre-commit | `bun test`, 90% coverage gate |
| L2 | API E2E (all REST endpoints) | pre-push | Custom BDD framework |
| L3 | Browser E2E (critical flows) | on-demand | Playwright |
| G1 | Type check + lint | pre-commit | `tsc --noEmit` + ESLint strict |
| G2 | Security scan | pre-push | osv-scanner + gitleaks |
