import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { authSession } from "../middleware/auth-session";
import type { SessionData } from "../lib/session";

function createApp(env: Partial<Env> = {}) {
  type AppEnv = { Bindings: Env; Variables: { user: SessionData } };
  const app = new Hono<AppEnv>();

  app.use("/*", authSession);

  app.get("/api/live", (c) => c.json({ status: "ok" }));
  app.get("/api/auth/me", (c) => c.json({ user: null }));
  app.post("/api/webhook/proj1/send", (c) => c.json({ ok: true }));
  app.post("/api/db/init", (c) => c.json({ ok: true }));
  app.get("/api/projects", (c) => {
    const user = c.get("user");
    return c.json({ email: user.email });
  });

  return {
    fetch: (req: Request) =>
      app.fetch(req, env as Env),
  };
}

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
}

const validSession: SessionData = {
  email: "allowed@example.com",
  name: "Allowed User",
  image: null,
  createdAt: new Date().toISOString(),
};

describe("authSession middleware", () => {
  test("skips /api/live", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/live"),
    );
    expect(res.status).toBe(200);
  });

  test("skips /api/auth/* routes", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/auth/me"),
    );
    expect(res.status).toBe(200);
  });

  test("skips /api/webhook/* routes", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/webhook/proj1/send", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("skips /api/db/init", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/db/init", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });

  test("localhost bypasses auth and sets dev user", async () => {
    const app = createApp({ ALLOWED_EMAILS: "admin@example.com" } as Partial<Env>);
    const res = await app.fetch(
      new Request("http://localhost:7034/api/projects"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("dev@localhost");
  });

  test("returns 500 if ALLOWED_EMAILS missing on non-localhost", async () => {
    const app = createApp({} as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("returns 401 if no session cookie", async () => {
    const app = createApp({ ALLOWED_EMAILS: "allowed@example.com" } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 401 if session token not found in KV", async () => {
    const kv = new MockKV();
    const app = createApp({
      ALLOWED_EMAILS: "allowed@example.com",
      KV: kv as unknown as KVNamespace,
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: {
          host: "dove.hexly.ai",
          cookie: "dove_session=invalid-token",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 403 if email not in whitelist", async () => {
    const kv = new MockKV();
    kv.seed("valid-token", {
      ...validSession,
      email: "notallowed@example.com",
    });
    const app = createApp({
      ALLOWED_EMAILS: "allowed@example.com",
      KV: kv as unknown as KVNamespace,
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: {
          host: "dove.hexly.ai",
          cookie: "dove_session=valid-token",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("passes with valid session and whitelisted email", async () => {
    const kv = new MockKV();
    kv.seed("valid-token", validSession);
    const app = createApp({
      ALLOWED_EMAILS: "allowed@example.com",
      KV: kv as unknown as KVNamespace,
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: {
          host: "dove.hexly.ai",
          cookie: "dove_session=valid-token",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("allowed@example.com");
  });

  test("email whitelist check is case-insensitive", async () => {
    const kv = new MockKV();
    kv.seed("valid-token", {
      ...validSession,
      email: "Allowed@Example.COM",
    });
    const app = createApp({
      ALLOWED_EMAILS: "allowed@example.com",
      KV: kv as unknown as KVNamespace,
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: {
          host: "dove.hexly.ai",
          cookie: "dove_session=valid-token",
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});
