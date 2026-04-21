import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import type { AccessUser } from "../middleware/auth-session";

const auth = new Hono<{ Bindings: Env }>();

function isDevMode(env: Env, host: string): boolean {
  if (env.DEV_MODE === "true") return true;
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  );
}

auth.get("/me", async (c) => {
  const host = c.req.header("host") ?? new URL(c.req.url).host;

  if (isDevMode(c.env, host)) {
    return c.json({ user: { email: "dev@localhost", name: "Dev User" } });
  }

  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = c.env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) {
    return c.json({ user: null });
  }

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return c.json({ user: null });
  }

  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    const { payload } = await jwtVerify(token, jwks, {
      audience: aud,
      issuer: `https://${teamDomain}`,
    });

    const email = payload.email as string | undefined;
    if (!email) {
      return c.json({ user: null });
    }

    return c.json({
      user: {
        email,
        name: (payload.name as string) ?? email,
      } satisfies AccessUser,
    });
  } catch {
    return c.json({ user: null });
  }
});

auth.get("/signout", (c) => {
  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
  if (!teamDomain) {
    return c.redirect("/");
  }
  return c.redirect(`https://${teamDomain}/cdn-cgi/access/logout`);
});

export { auth };
