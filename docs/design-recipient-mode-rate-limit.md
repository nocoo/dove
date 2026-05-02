# Design: Per-Project Recipient Mode & Rate Limiting (v2)

## 1. Requirements Summary

| # | Requirement | Status |
|---|---|---|
| R1 | Project Settings UI: toggle between "Whitelist" (default) and "Any recipient" mode | Backend exists, UI missing |
| R2 | "Any recipient" mode skips whitelist, accepts any valid email | Already implemented in webhook.ts |
| R3 | Per-address rate limit: same (project, email) cannot send more than 1x per 5 min | New feature |
| R4 | Daily/monthly quota applies to ALL recipients regardless of mode | Already implemented |

## 2. Existing Infrastructure

### What Already Works
- `allow_unknown_recipients` boolean on Project (DB column + API + type)
- Webhook send flow has two modes based on this flag (webhook.ts L204–227)
- API accepts `allow_unknown_recipients` in project create/update schemas
- Daily/monthly quota via `checkQuota()` counting from `send_logs.sent_at`

### What's Missing
- **Frontend toggle** in project detail page for `allow_unknown_recipients`
- **Per-address rate limit** — no rate limiting by recipient email exists
- **Lock table** for atomic rate-limit enforcement

## 3. Design

### 3.1 Per-Address Rate Limit (5-min cooldown) — Strict Lock Table

**Why not query send_logs?**
A `SELECT COUNT` then send is not atomic. Under concurrent webhook calls to the same (project, email), both requests pass the check simultaneously. A dedicated lock table with UNIQUE constraint provides atomic enforcement.

**New table: `rate_limit_locks`**
```sql
CREATE TABLE IF NOT EXISTS rate_limit_locks (
  project_id TEXT NOT NULL,
  to_email TEXT NOT NULL,        -- normalized: trim().toLowerCase()
  blocked_until TEXT NOT NULL,   -- UTC ISO-8601 timestamp
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, to_email)
);
```

The `PRIMARY KEY (project_id, to_email)` enforces uniqueness. Only one lock per (project, email) can exist.

**Algorithm:**
1. After recipient is resolved (Step 5), normalize email → `recipient.email`
2. Query: `SELECT blocked_until FROM rate_limit_locks WHERE project_id = ? AND to_email = ?`
3. If row exists AND `blocked_until > now()` → reject with 429
4. If row exists but expired (or no row) → proceed (lock will be acquired/refreshed after send)
5. After successful send: `INSERT OR REPLACE INTO rate_limit_locks (project_id, to_email, blocked_until, created_at) VALUES (?, ?, datetime('now', '+5 minutes'), datetime('now'))`
6. After failed send: `DELETE FROM rate_limit_locks WHERE project_id = ? AND to_email = ?` (release lock, allow retry)

**Concurrency edge case:**
Two concurrent requests both see "no lock / expired lock" at step 2–3. Both proceed to send. Both succeed. Both write the lock. Result: 2 emails sent within 5 minutes, but the lock is now in place for the next 5 min. This is acceptable as a 1-in-a-million edge — D1 serializes writes at the database level, so in practice the second INSERT OR REPLACE will still succeed but the user gets one extra email at most. For strict single-send guarantee, we'd need D1 transactions (batch), but the risk/complexity tradeoff isn't worth it for email delivery.

**Alternative (stricter): acquire-before-send**
1. `INSERT OR IGNORE INTO rate_limit_locks` with `blocked_until = datetime('now', '+5 minutes')`
2. If insert affected 0 rows → check if existing lock is expired:
   - `UPDATE rate_limit_locks SET blocked_until = ... WHERE project_id = ? AND to_email = ? AND blocked_until <= datetime('now')`
   - If 0 rows updated → lock is active, reject 429
3. Proceed to send
4. On failure: delete lock

This gives strict atomic enforcement. **Recommended approach.**

**New function (`src/server/lib/email/rate-limit.ts`):**
```typescript
export interface RateLimitCheck {
  allowed: boolean;
  retry_after_seconds?: number;
}

export async function acquireAddressLock(
  db: D1Database,
  projectId: string,
  toEmail: string,
  windowMinutes?: number,
): Promise<RateLimitCheck>

export async function releaseAddressLock(
  db: D1Database,
  projectId: string,
  toEmail: string,
): Promise<void>
```

**Webhook integration (webhook.ts):**
Insert rate-limit check AFTER Step 5 (Recipient resolution), BEFORE Step 6 (Template):
- Uses `recipient.email` (already normalized, lowercase, trimmed)
- Returns 429 with:
  - Header: `Retry-After: <seconds>`
  - Body: `{ "error": { "code": "rate_limit_address", "message": "...", "retry_after_seconds": N } }`

**On send success:** lock stays (already acquired with `blocked_until` = now + 5min)
**On send failure:** call `releaseAddressLock()` so caller can retry immediately

### 3.2 Frontend: Recipient Mode Toggle

In the **Recipients card** of project detail page (`src/client/routes/projects/$id.tsx`):

**Type change:**
```typescript
interface Project {
  // ... existing fields ...
  allow_unknown_recipients: boolean; // ADD THIS
}
```

**UI behavior:**
- Add a toggle/switch at the top of the Recipients card, between header and list
- Label: "Accept any email address"
- Description: "When enabled, sends skip the whitelist and accept any valid email address. Rate limits and quotas still apply. Your existing whitelist is preserved and re-activated if you turn this off."
- Independent loading state (not tied to the main "Save Changes" button)
- On toggle: immediately `PUT /api/projects/:id { allow_unknown_recipients: value }`
- On failure: revert toggle state, show toast error
- When ON: collapse/hide the recipient list and "Add" button (with a subtle note)
- When OFF: show whitelist as today

**Dirty state:**
The toggle should NOT be part of the main form's `dirty` state since it saves immediately.

### 3.3 Schema Changes

**New migration: `migrations/2026-05-02-rate-limit-locks.sql`**
```sql
CREATE TABLE IF NOT EXISTS rate_limit_locks (
  project_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  blocked_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, to_email)
);
```

**Update `db-init.ts` SCHEMA_SQL:** add the table + PK so fresh DBs get it.

**Update `schema.sql`:** add documentation for the new table.

### 3.4 Lock Cleanup

Expired locks accumulate over time. Options:
- **Lazy cleanup**: before INSERT, DELETE expired rows for this (project_id, to_email). Already handled by the UPDATE approach.
- **Periodic cleanup** (optional, deferred): a scheduled worker or cron that DELETEs `WHERE blocked_until < datetime('now', '-1 hour')`. Not critical for MVP since expired rows don't affect correctness.

## 4. File Changes

| File | Change |
|---|---|
| `src/server/lib/email/rate-limit.ts` | New: `acquireAddressLock()`, `releaseAddressLock()` |
| `src/server/routes/webhook.ts` | Add rate-limit acquire between Step 5 and Step 6; release on failure |
| `src/server/routes/db-init.ts` | Add `rate_limit_locks` table to SCHEMA_SQL |
| `src/server/schema.sql` | Add `rate_limit_locks` table documentation |
| `src/client/routes/projects/$id.tsx` | Add `allow_unknown_recipients` to Project type, add toggle UI |
| `migrations/2026-05-02-rate-limit-locks.sql` | New migration |
| `src/server/__tests__/rate-limit.test.ts` | New: lock acquire/release unit tests |
| `src/server/__tests__/isolated/routes-webhook.test.ts` | Add rate-limit E2E cases |
| `e2e/api/webhook.test.ts` | Add rate-limit integration cases |

## 5. Decisions (Confirmed)

| Decision | Choice |
|---|---|
| Rate limit scope | Per (project_id, to_email) |
| Rate limit applies to | Both whitelist and any-recipient mode |
| Response format | `Retry-After` header + JSON `retry_after_seconds` |
| Failure handling | Release lock on provider failure, keep on success |
| Concurrency model | Strict — acquire-before-send with atomic INSERT/UPDATE |
| Frontend toggle | Independent save, not part of form dirty state |
| Whitelist preservation | Switching to "any recipient" preserves existing whitelist entries |

## 6. Test Plan

### Unit Tests (`rate-limit.test.ts`)
- `acquireAddressLock()` — succeeds when no lock exists
- `acquireAddressLock()` — succeeds when lock is expired
- `acquireAddressLock()` — fails when lock is active → returns retry_after_seconds
- `releaseAddressLock()` — removes the lock row
- Email normalization: `Foo@Bar.COM` and `foo@bar.com` share the same lock
- Different projects, same email: independent locks

### Webhook Integration Tests
- Send once → 200, send again immediately → 429 with rate_limit_address
- Send fails → lock released → retry immediately succeeds
- `to` as recipient ID → rate limit uses resolved `recipient.email`
- Both whitelist mode and any-recipient mode enforce rate limit

### E2E Tests
- Send to same address twice within 5min → second returns 429
- Send to different addresses → both succeed
- Same address in different projects → both succeed
- Verify `Retry-After` header present on 429
