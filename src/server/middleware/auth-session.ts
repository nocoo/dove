import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";

export interface AccessUser {
	email: string;
	name: string;
}

type AccessEnv = {
	Bindings: Env;
	Variables: { user: AccessUser };
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(teamDomain: string) {
	let jwks = jwksCache.get(teamDomain);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
		jwksCache.set(teamDomain, jwks);
	}
	return jwks;
}

function isLocalhost(host: string): boolean {
	return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

function isDevMode(env: Env, host: string): boolean {
	if (env.DEV_MODE === "true") return true;
	return isLocalhost(host);
}

export const DEV_USER: AccessUser = {
	email: "architie@gmail.com",
	name: "Dev User",
};

export const authSession = createMiddleware<AccessEnv>(async (c, next) => {
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

	const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
	const aud = c.env.CF_ACCESS_AUD;
	if (!teamDomain || !aud) {
		return c.json({ error: "Server misconfiguration" }, 500);
	}

	const token = c.req.header("Cf-Access-Jwt-Assertion");
	if (!token) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	try {
		const { payload } = await jwtVerify(token, getJWKS(teamDomain), {
			audience: aud,
			issuer: `https://${teamDomain}`,
		});

		const email = payload.email as string | undefined;
		if (!email) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		c.set("user", {
			email,
			name: (payload.name as string) ?? email,
		});

		return next();
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
});
