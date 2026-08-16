import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Env } from "../env";
import { AUTHOR_PROFILE_URL } from "../lib/author-profile";
import { DEV_USER } from "../middleware/auth-session";
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
			const res = await app.fetch(new Request("http://localhost:7034/api/auth/me"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				user: { email: string; name: string };
			};
			expect(body.user.email).toBe(DEV_USER.email);
			expect(body.user.name).toBe(DEV_USER.name);
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
			expect(body.user.email).toBe(DEV_USER.email);
			// Pin name too — a regression that injected a different bypass
			// identity on production-host DEV_MODE branch (e.g. blank name,
			// or the host-based 'admin@hexly.ai') would silently pass and
			// could be a privilege-escalation footgun in non-dev deployments.
			expect(body.user.name).toBe(DEV_USER.name);
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

	describe("GET /api/auth/profile", () => {
		const mockFetch = vi.fn();

		beforeEach(() => {
			vi.stubGlobal("fetch", mockFetch);
			mockFetch.mockReset();
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		test("returns public name and avatar for the dev user", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						name: "Zheng Li",
						avatar: "https://cdn.example.com/avatar-80.jpg",
					}),
			});
			const app = createApp();
			const res = await app.fetch(new Request("http://localhost:7034/api/auth/profile"));
			expect(res.status).toBe(200);
			const body = (await res.json()) as { name: string | null; avatar: string | null };
			expect(body).toEqual({
				name: "Zheng Li",
				avatar: "https://cdn.example.com/avatar-80.jpg",
			});
			expect(body).not.toHaveProperty("email");
			const [url] = mockFetch.mock.calls[0] as [string];
			expect(url.startsWith(`${AUTHOR_PROFILE_URL}?hash=`)).toBe(true);
			expect(url).not.toContain("@");
		});

		test("returns nulls when CF Access identity is missing", async () => {
			const app = createApp({
				CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
				CF_ACCESS_AUD: "test-aud",
			} as Partial<Env>);
			const res = await app.fetch(
				new Request("https://dove.hexly.ai/api/auth/profile", {
					headers: { host: "dove.hexly.ai" },
				}),
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ name: null, avatar: null });
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/auth/signout", () => {
		test("redirects to CF Access logout when team domain set", async () => {
			const app = createApp({
				CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
			} as Partial<Env>);
			const res = await app.fetch(new Request("http://localhost:7034/api/auth/signout"));
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe(
				"https://myteam.cloudflareaccess.com/cdn-cgi/access/logout",
			);
		});

		test("redirects to / when team domain not set", async () => {
			const app = createApp({});
			const res = await app.fetch(new Request("http://localhost:7034/api/auth/signout"));
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("/");
		});
	});
});
