/**
 * D1 native binding thin wrapper.
 *
 * Provides typed query helpers for Cloudflare D1 within Workers.
 * Replaces the HTTP proxy client for sub-millisecond latency.
 */

/**
 * Execute a SELECT query and return all matching rows.
 */
export async function query<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
	const stmt = db.prepare(sql).bind(...params);
	const result = await stmt.all<T>();
	return result.results;
}

/**
 * Execute a SELECT query and return the first matching row (or null).
 */
export async function queryOne<T>(
	db: D1Database,
	sql: string,
	params: unknown[] = [],
): Promise<T | null> {
	const stmt = db.prepare(sql).bind(...params);
	const result = await stmt.first<T>();
	return result ?? null;
}

/**
 * Execute a write statement (INSERT/UPDATE/DELETE).
 */
export async function execute(
	db: D1Database,
	sql: string,
	params: unknown[] = [],
): Promise<D1Result> {
	const stmt = db.prepare(sql).bind(...params);
	return stmt.run();
}

/**
 * Execute multiple statements in a batch (single round-trip).
 */
export async function batch(
	db: D1Database,
	statements: { sql: string; params?: unknown[] }[],
): Promise<D1Result[]> {
	const stmts = statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? [])));
	return db.batch(stmts);
}
