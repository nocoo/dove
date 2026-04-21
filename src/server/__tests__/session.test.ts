import { describe, test, expect, beforeEach } from "bun:test";
import {
  createSession,
  getSession,
  deleteSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL,
} from "../lib/session";

class MockKV {
  private store = new Map<string, { value: string; expiration: number | undefined }>();

  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, {
      value,
      expiration: opts?.expirationTtl,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  getExpiration(key: string): number | undefined {
    return this.store.get(key)?.expiration;
  }

  size(): number {
    return this.store.size;
  }
}

describe("session", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = new MockKV();
  });

  test("createSession returns a 48-char token", async () => {
    const token = await createSession(kv as unknown as KVNamespace, {
      email: "test@example.com",
      name: "Test User",
      image: null,
    });
    expect(token).toHaveLength(48);
  });

  test("createSession stores session data with TTL", async () => {
    const token = await createSession(kv as unknown as KVNamespace, {
      email: "test@example.com",
      name: "Test User",
      image: "https://example.com/avatar.png",
    });

    expect(kv.size()).toBe(1);
    const expiration = kv.getExpiration(`dove_session:${token}`);
    expect(expiration).toBe(SESSION_TTL);
  });

  test("getSession returns stored data", async () => {
    const token = await createSession(kv as unknown as KVNamespace, {
      email: "test@example.com",
      name: "Test User",
      image: null,
    });

    const session = await getSession(kv as unknown as KVNamespace, token);
    expect(session).not.toBeNull();
    expect(session!.email).toBe("test@example.com");
    expect(session!.name).toBe("Test User");
    expect(session!.image).toBeNull();
    expect(session!.createdAt).toBeTruthy();
  });

  test("getSession returns null for unknown token", async () => {
    const session = await getSession(
      kv as unknown as KVNamespace,
      "nonexistent-token",
    );
    expect(session).toBeNull();
  });

  test("deleteSession removes the session", async () => {
    const token = await createSession(kv as unknown as KVNamespace, {
      email: "test@example.com",
      name: "Test User",
      image: null,
    });

    await deleteSession(kv as unknown as KVNamespace, token);
    const session = await getSession(kv as unknown as KVNamespace, token);
    expect(session).toBeNull();
  });

  test("each createSession generates unique tokens", async () => {
    const data = { email: "test@example.com", name: "Test", image: null };
    const token1 = await createSession(kv as unknown as KVNamespace, data);
    const token2 = await createSession(kv as unknown as KVNamespace, data);
    expect(token1).not.toBe(token2);
  });

  test("SESSION_COOKIE_NAME is dove_session", () => {
    expect(SESSION_COOKIE_NAME).toBe("dove_session");
  });

  test("SESSION_TTL is 7 days in seconds", () => {
    expect(SESSION_TTL).toBe(7 * 24 * 60 * 60);
  });
});
