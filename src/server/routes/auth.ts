import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import { EMPTY_AUTHOR_PROFILE, fetchAuthorProfile } from "../lib/author-profile";
import { type AccessUser, DEV_USER } from "../middleware/auth-session";

const auth = new Hono<{ Bindings: Env }>();

function isDevMode(env: Env, host: string): boolean {
	if (env.DEV_MODE === "true") return true;
	return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

async function resolveUser(
	env: Env,
	host: string,
	token: string | undefined,
): Promise<AccessUser | null> {
	if (isDevMode(env, host)) return DEV_USER;

	const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
	const aud = env.CF_ACCESS_AUD;
	if (!teamDomain || !aud) return null;
	if (!token) return null;

	try {
		const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
		const { payload } = await jwtVerify(token, jwks, {
			audience: aud,
			issuer: `https://${teamDomain}`,
		});

		const email = payload.email as string | undefined;
		if (!email) return null;

		return {
			email,
			name: (payload.name as string) ?? email,
		};
	} catch {
		return null;
	}
}

auth.get("/me", async (c) => {
	const host = c.req.header("host") ?? new URL(c.req.url).host;
	const user = await resolveUser(c.env, host, c.req.header("Cf-Access-Jwt-Assertion"));
	return c.json({ user });
});

auth.get("/profile", async (c) => {
	const host = c.req.header("host") ?? new URL(c.req.url).host;
	const user = await resolveUser(c.env, host, c.req.header("Cf-Access-Jwt-Assertion"));
	if (!user) return c.json(EMPTY_AUTHOR_PROFILE);
	return c.json(await fetchAuthorProfile(user.email));
});

auth.get("/signout", (c) => {
	const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
	if (!teamDomain) {
		return c.redirect("/");
	}
	return c.redirect(`https://${teamDomain}/cdn-cgi/access/logout`);
});

export { auth };
