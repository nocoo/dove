import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import {
  getSession,
  SESSION_COOKIE_NAME,
  type SessionData,
} from "../lib/session";
import { getCookie } from "hono/cookie";

type SessionEnv = {
  Bindings: Env;
  Variables: { user: SessionData };
};

function isLocalhost(host: string): boolean {
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  );
}

function isDevMode(env: Env, host: string): boolean {
  if (env.DEV_MODE === "true") return true;
  return isLocalhost(host);
}

const DEV_USER: SessionData = {
  email: "dev@localhost",
  name: "Dev User",
  image: null,
  createdAt: new Date().toISOString(),
};

export const authSession = createMiddleware<SessionEnv>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  if (
    path === "/api/live" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/webhook/") ||
    path === "/api/db/init"
  ) {
    return next();
  }

  const host = c.req.header("host") ?? new URL(c.req.url).host;
  if (isDevMode(c.env, host)) {
    c.set("user", DEV_USER);
    return next();
  }

  const allowedEmails = c.env.ALLOWED_EMAILS;
  if (!allowedEmails) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = await getSession(c.env.KV, token);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const whitelist = allowedEmails
    .split(",")
    .map((e) => e.trim().toLowerCase());
  if (!whitelist.includes(session.email.toLowerCase())) {
    return c.json({ error: "Forbidden" }, 403);
  }

  c.set("user", session);
  return next();
});
