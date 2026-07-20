/**
 * Per-address send rate limiting.
 *
 * Uses a dedicated `rate_limit_locks` table with a PRIMARY KEY on
 * (project_id, to_email) for atomic enforcement. Each lock carries a
 * random `lock_token` so only the request that acquired the lock can
 * release it on failure.
 *
 * Flow:
 *   1. acquireAddressLock() — attempts to claim or refresh an expired lock
 *   2. (caller sends email)
 *   3a. On success: lock stays — blocked_until enforces the cooldown
 *   3b. On failure: releaseAddressLock(token) — removes the lock so the
 *       caller can retry immediately
 */

import { execute, queryOne } from "../db/d1";

const DEFAULT_WINDOW_MINUTES = 5;

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the lock expires. Present when allowed=false. */
	retry_after_seconds?: number;
	/** Opaque token to pass to releaseAddressLock on send failure. */
	lock_token?: string;
}

/**
 * Attempt to acquire a per-(project, email) rate-limit lock.
 *
 * Algorithm:
 *   1. INSERT OR IGNORE — succeeds if no row exists
 *   2. If insert returned 0 changes (row exists), UPDATE only if expired
 *   3. If UPDATE returned 0 changes — lock is active → reject
 */
export async function acquireAddressLock(
	db: D1Database,
	projectId: string,
	toEmail: string,
	windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): Promise<RateLimitResult> {
	const now = new Date();
	const nowIso = now.toISOString();
	const blockedUntil = new Date(now.getTime() + windowMinutes * 60_000).toISOString();
	const lockToken = crypto.randomUUID();

	// Step 1: try inserting a new lock row
	const insertResult = await execute(
		db,
		`INSERT OR IGNORE INTO rate_limit_locks (project_id, to_email, blocked_until, lock_token, created_at)
     VALUES (?, ?, ?, ?, ?)`,
		[projectId, toEmail, blockedUntil, lockToken, nowIso],
	);

	if ((insertResult.meta?.changes ?? 0) > 0) {
		// Fresh lock acquired
		return { allowed: true, lock_token: lockToken };
	}

	// Step 2: row exists — try to refresh only if expired
	const updateResult = await execute(
		db,
		`UPDATE rate_limit_locks
     SET blocked_until = ?, lock_token = ?, created_at = ?
     WHERE project_id = ? AND to_email = ? AND blocked_until <= ?`,
		[blockedUntil, lockToken, nowIso, projectId, toEmail, nowIso],
	);

	if ((updateResult.meta?.changes ?? 0) > 0) {
		// Expired lock refreshed
		return { allowed: true, lock_token: lockToken };
	}

	// Step 3: lock is still active — compute retry_after
	const existing = await queryOne<{ blocked_until: string }>(
		db,
		`SELECT blocked_until FROM rate_limit_locks WHERE project_id = ? AND to_email = ?`,
		[projectId, toEmail],
	);

	let retryAfter = windowMinutes * 60;
	if (existing?.blocked_until) {
		const expiresAt = new Date(existing.blocked_until).getTime();
		retryAfter = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
	}

	return { allowed: false, retry_after_seconds: retryAfter };
}

/**
 * Release a lock that was acquired by this request.
 *
 * Uses lock_token to ensure we only delete our own lock — a concurrent
 * request that acquired a newer lock for the same (project, email)
 * won't be affected.
 */
export async function releaseAddressLock(
	db: D1Database,
	projectId: string,
	toEmail: string,
	lockToken: string,
): Promise<void> {
	await execute(
		db,
		`DELETE FROM rate_limit_locks
     WHERE project_id = ? AND to_email = ? AND lock_token = ?`,
		[projectId, toEmail, lockToken],
	);
}
