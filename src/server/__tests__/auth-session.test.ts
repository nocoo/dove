import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { authSession, type AccessUser } from "../middleware/auth-session";

function createApp(env: Partial<Env> = {}) {
  type AppEnv = { Bindings: Env; Variables: { user: AccessUser } };
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
    fetch: (req: Request) => app.fetch(req, env as Env),
  };
}

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
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:7034/api/projects"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("dev@localhost");
  });

  test("DEV_MODE=true bypasses auth on non-localhost", async () => {
    const app = createApp({ DEV_MODE: "true" } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("dev@localhost");
  });

  test("returns 500 if CF_ACCESS_TEAM_DOMAIN missing on non-localhost", async () => {
    const app = createApp({});
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("returns 500 if CF_ACCESS_AUD missing on non-localhost", async () => {
    const app = createApp({
      CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("returns 401 if no Cf-Access-Jwt-Assertion header", async () => {
    const app = createApp({
      CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-aud",
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: { host: "dove.hexly.ai" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 401 for invalid JWT", async () => {
    const app = createApp({
      CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-aud",
    } as Partial<Env>);
    const res = await app.fetch(
      new Request("https://dove.hexly.ai/api/projects", {
        headers: {
          host: "dove.hexly.ai",
          "Cf-Access-Jwt-Assertion": "invalid.jwt.token",
        },
      }),
    );
    expect(res.status).toBe(401);
  });
});
