import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { auth } from "../routes/auth";
import type { SessionData } from "../lib/session";

class MockKV {
  private store = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  seed(token: string, data: SessionData): void {
    this.store.set(`dove_session:${token}`, JSON.stringify(data));
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

function createApp(kv: MockKV) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/auth", auth);
  return {
    fetch: (req: Request) =>
      app.fetch(req, { KV: kv as unknown as KVNamespace } as Env),
  };
}

const validSession: SessionData = {
  email: "user@example.com",
  name: "Test User",
  image: "https://example.com/avatar.png",
  createdAt: new Date().toISOString(),
};

describe("auth routes", () => {
  describe("GET /api/auth/me", () => {
    test("returns null user when no cookie", async () => {
      const kv = new MockKV();
      const app = createApp(kv);
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/me"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: null };
      expect(body.user).toBeNull();
    });

    test("returns dev user on localhost with any cookie", async () => {
      const kv = new MockKV();
      const app = createApp(kv);
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/me", {
          headers: { cookie: "dove_session=any-token" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { email: string; name: string };
      };
      expect(body.user.email).toBe("dev@localhost");
      expect(body.user.name).toBe("Dev User");
    });

    test("returns user data for valid session on non-localhost", async () => {
      const kv = new MockKV();
      kv.seed("valid-token", validSession);
      const app = createApp(kv);
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: {
            host: "dove.hexly.ai",
            cookie: "dove_session=valid-token",
          },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { email: string; name: string; image: string };
      };
      expect(body.user.email).toBe("user@example.com");
      expect(body.user.name).toBe("Test User");
      expect(body.user.image).toBe("https://example.com/avatar.png");
    });

    test("returns null and clears cookie for expired session", async () => {
      const kv = new MockKV();
      const app = createApp(kv);
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: {
            host: "dove.hexly.ai",
            cookie: "dove_session=expired-token",
          },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: null };
      expect(body.user).toBeNull();
      expect(res.headers.get("set-cookie")).toContain("dove_session=");
    });
  });

  describe("POST /api/auth/signout", () => {
    test("deletes session from KV and clears cookie", async () => {
      const kv = new MockKV();
      kv.seed("signout-token", validSession);
      const app = createApp(kv);

      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/signout", {
          method: "POST",
          headers: { cookie: "dove_session=signout-token" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(kv.has("dove_session:signout-token")).toBe(false);
    });

    test("succeeds even without cookie", async () => {
      const kv = new MockKV();
      const app = createApp(kv);
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/signout", {
          method: "POST",
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});
