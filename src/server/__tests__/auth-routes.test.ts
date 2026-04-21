import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import type { Env } from "../env";
import { auth } from "../routes/auth";

function createApp(env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/auth", auth);
  return {
    fetch: (req: Request) => app.fetch(req, env as Env),
  };
}

describe("auth routes", () => {
  describe("GET /api/auth/me", () => {
    test("returns dev user on localhost", async () => {
      const app = createApp();
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/me"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { email: string; name: string };
      };
      expect(body.user.email).toBe("dev@localhost");
      expect(body.user.name).toBe("Dev User");
    });

    test("returns dev user when DEV_MODE=true on non-localhost", async () => {
      const app = createApp({ DEV_MODE: "true" } as Partial<Env>);
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: { host: "dove.hexly.ai" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { email: string; name: string };
      };
      expect(body.user.email).toBe("dev@localhost");
    });

    test("returns null user when no JWT on non-localhost", async () => {
      const app = createApp({
        CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
        CF_ACCESS_AUD: "test-aud",
      } as Partial<Env>);
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: { host: "dove.hexly.ai" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: null };
      expect(body.user).toBeNull();
    });

    test("returns null user when CF_ACCESS vars missing", async () => {
      const app = createApp({});
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: { host: "dove.hexly.ai" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: null };
      expect(body.user).toBeNull();
    });

    test("returns null user for invalid JWT", async () => {
      const app = createApp({
        CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
        CF_ACCESS_AUD: "test-aud",
      } as Partial<Env>);
      const res = await app.fetch(
        new Request("https://dove.hexly.ai/api/auth/me", {
          headers: {
            host: "dove.hexly.ai",
            "Cf-Access-Jwt-Assertion": "invalid.jwt.token",
          },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: null };
      expect(body.user).toBeNull();
    });
  });

  describe("GET /api/auth/signout", () => {
    test("redirects to CF Access logout when team domain set", async () => {
      const app = createApp({
        CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
      } as Partial<Env>);
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/signout"),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "https://myteam.cloudflareaccess.com/cdn-cgi/access/logout",
      );
    });

    test("redirects to / when team domain not set", async () => {
      const app = createApp({});
      const res = await app.fetch(
        new Request("http://localhost:7034/api/auth/signout"),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });
  });
});
