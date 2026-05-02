import { describe, test, expect, vi, beforeEach } from "vitest";
import { acquireAddressLock, releaseAddressLock } from "../lib/email/rate-limit";

/**
 * Mock D1Database that simulates the rate_limit_locks table behavior.
 *
 * We store locks in a Map and implement the SQL semantics
 * (INSERT OR IGNORE, conditional UPDATE, DELETE with token match).
 */
function createMockDB() {
  const locks = new Map<string, { blocked_until: string; lock_token: string; created_at: string }>();

  function makeKey(projectId: string, toEmail: string) {
    return `${projectId}::${toEmail}`;
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        const p = params.map(String);
        return {
          run: vi.fn(() => {
            if (/INSERT OR IGNORE/i.test(sql)) {
              const key = makeKey(p[0]!, p[1]!);
              if (locks.has(key)) {
                return Promise.resolve({ meta: { changes: 0 }, success: true });
              }
              locks.set(key, { blocked_until: p[2]!, lock_token: p[3]!, created_at: p[4]! });
              return Promise.resolve({ meta: { changes: 1 }, success: true });
            }

            if (/UPDATE rate_limit_locks/i.test(sql)) {
              // params: [blockedUntil, lockToken, createdAt, projectId, toEmail, nowIso]
              const key = makeKey(p[3]!, p[4]!);
              const existing = locks.get(key);
              if (existing && existing.blocked_until <= p[5]!) {
                locks.set(key, { blocked_until: p[0]!, lock_token: p[1]!, created_at: p[2]! });
                return Promise.resolve({ meta: { changes: 1 }, success: true });
              }
              return Promise.resolve({ meta: { changes: 0 }, success: true });
            }

            if (/DELETE FROM rate_limit_locks/i.test(sql)) {
              // params: [projectId, toEmail, lockToken]
              const key = makeKey(p[0]!, p[1]!);
              const existing = locks.get(key);
              if (existing && existing.lock_token === p[2]!) {
                locks.delete(key);
                return Promise.resolve({ meta: { changes: 1 }, success: true });
              }
              return Promise.resolve({ meta: { changes: 0 }, success: true });
            }

            return Promise.resolve({ meta: { changes: 0 }, success: true });
          }),
          first: vi.fn(() => {
            if (/SELECT blocked_until/i.test(sql)) {
              const key = makeKey(p[0]!, p[1]!);
              const existing = locks.get(key);
              return Promise.resolve(existing ? { blocked_until: existing.blocked_until } : null);
            }
            return Promise.resolve(null);
          }),
          all: vi.fn(() => Promise.resolve({ results: [] })),
        };
      }),
    })),
    _locks: locks,
    _makeKey: makeKey,
  };

  return db as unknown as D1Database & {
    _locks: typeof locks;
    _makeKey: typeof makeKey;
  };
}

// Stub crypto.randomUUID for deterministic tests
let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.stubGlobal("crypto", {
    ...crypto,
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  });
});

describe("rate-limit: acquireAddressLock", () => {
  test("succeeds when no lock exists", async () => {
    const db = createMockDB();
    const result = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(result.allowed).toBe(true);
    expect(result.lock_token).toBeDefined();
    expect(result.retry_after_seconds).toBeUndefined();
  });

  test("rejects when lock is active (not expired)", async () => {
    const db = createMockDB();

    const first = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(first.allowed).toBe(true);

    const second = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(second.allowed).toBe(false);
    expect(second.retry_after_seconds).toBeGreaterThan(0);
    expect(second.retry_after_seconds).toBeLessThanOrEqual(300);
  });

  test("succeeds when existing lock is expired", async () => {
    const db = createMockDB();
    const key = db._makeKey("proj_001", "user@example.com");

    // Plant an expired lock
    const pastTime = new Date(Date.now() - 10 * 60_000).toISOString();
    db._locks.set(key, {
      blocked_until: pastTime,
      lock_token: "old-token",
      created_at: pastTime,
    });

    const result = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(result.allowed).toBe(true);
    expect(result.lock_token).toBeDefined();
  });

  test("different projects have independent locks", async () => {
    const db = createMockDB();

    const first = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(first.allowed).toBe(true);

    const second = await acquireAddressLock(db, "proj_002", "user@example.com");
    expect(second.allowed).toBe(true);
  });

  test("same address same project is blocked", async () => {
    const db = createMockDB();

    const first = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(first.allowed).toBe(true);

    const second = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(second.allowed).toBe(false);
  });

  test("custom window duration is respected", async () => {
    const db = createMockDB();

    const result = await acquireAddressLock(db, "proj_001", "user@example.com", 10);
    expect(result.allowed).toBe(true);

    // Check that blocked_until is ~10 minutes from now
    const key = db._makeKey("proj_001", "user@example.com");
    const lock = db._locks.get(key)!;
    const blockedUntil = new Date(lock.blocked_until).getTime();
    const expectedMin = Date.now() + 9 * 60_000;
    const expectedMax = Date.now() + 11 * 60_000;
    expect(blockedUntil).toBeGreaterThan(expectedMin);
    expect(blockedUntil).toBeLessThan(expectedMax);
  });
});

describe("rate-limit: releaseAddressLock", () => {
  test("removes lock with matching token", async () => {
    const db = createMockDB();

    const result = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(result.allowed).toBe(true);
    const token = result.lock_token!;

    await releaseAddressLock(db, "proj_001", "user@example.com", token);

    // Lock should be gone — next acquire succeeds
    const second = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(second.allowed).toBe(true);
  });

  test("does NOT remove lock with non-matching token (ownership protection)", async () => {
    const db = createMockDB();

    const result = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(result.allowed).toBe(true);

    // Attempt release with wrong token
    await releaseAddressLock(db, "proj_001", "user@example.com", "wrong-token");

    // Lock should still be active
    const second = await acquireAddressLock(db, "proj_001", "user@example.com");
    expect(second.allowed).toBe(false);
  });
});
