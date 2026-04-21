import { Hono } from "hono";
import { googleAuth } from "@hono/oauth-providers/google";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import {
  createSession,
  deleteSession,
  getSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL,
} from "../lib/session";
import { getCookie } from "hono/cookie";

const auth = new Hono<{ Bindings: Env }>();

auth.get(
  "/google",
  (c, next) => {
    return googleAuth({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      scope: ["openid", "email", "profile"],
      redirect_uri: new URL("/api/auth/google/callback", c.req.url).toString(),
    })(c, next);
  },
);

auth.get(
  "/google/callback",
  (c, next) => {
    return googleAuth({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      scope: ["openid", "email", "profile"],
      redirect_uri: new URL("/api/auth/google/callback", c.req.url).toString(),
    })(c, next);
  },
  async (c) => {
    const googleUser = c.get("user-google");
    const email = googleUser?.email;
    if (!email) {
      return c.redirect("/login?error=no_email");
    }

    const allowedEmails = c.env.ALLOWED_EMAILS;
    if (!allowedEmails) {
      return c.json({ error: "Server misconfiguration" }, 500);
    }

    const whitelist = allowedEmails
      .split(",")
      .map((e) => e.trim().toLowerCase());
    if (!whitelist.includes(email.toLowerCase())) {
      return c.redirect("/login?error=not_allowed");
    }

    const token = await createSession(c.env.KV, {
      email,
      name: googleUser.name ?? email,
      image: googleUser.picture ?? null,
    });

    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL,
    });

    return c.redirect("/");
  },
);

auth.post("/signout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) {
    await deleteSession(c.env.KV, token);
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ user: null });
  }

  const host = c.req.header("host") ?? new URL(c.req.url).host;
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");

  if (isLocal) {
    return c.json({
      user: { email: "dev@localhost", name: "Dev User", image: null },
    });
  }

  const session = await getSession(c.env.KV, token);
  if (!session) {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ user: null });
  }

  return c.json({
    user: {
      email: session.email,
      name: session.name,
      image: session.image,
    },
  });
});

export { auth };
