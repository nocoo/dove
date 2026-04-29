import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock jose so we can drive jwtVerify outcomes without a real JWKS.
const mockJwtVerify = vi.fn();
const mockCreateJWKS = vi.fn(() => ({}) as unknown);
vi.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateJWKS,
}));

beforeEach(() => {
  mockJwtVerify.mockReset();
  mockCreateJWKS.mockClear();
  mockCreateJWKS.mockImplementation(() => ({}) as unknown);
});

const env = {
  CF_ACCESS_TEAM_DOMAIN: "myteam.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
} as unknown;

async function loadAuthApp() {
  const { Hono } = await import("hono");
  const { auth } = await import("../../routes/auth");
  const app = new Hono();
  app.route("/api/auth", auth);
  return (req: Request) => app.fetch(req, env as Parameters<typeof app.fetch>[1]);
}

async function loadProtectedApp() {
  const { Hono } = await import("hono");
  const { authSession } = await import("../../middleware/auth-session");
  const app = new Hono();
  app.use("*", authSession);
  app.get("/api/projects", (c) => {
    const user = c.get("user" as never) as { email: string; name: string } | undefined;
    return c.json({ user });
  });
  return (req: Request) => app.fetch(req, env as Parameters<typeof app.fetch>[1]);
}

const headers = { host: "dove.hexly.ai", "Cf-Access-Jwt-Assertion": "x.y.z" };

describe("auth.ts /me success branch (jose mocked)", () => {
  test("returns user with name from payload when email + name present", async () => {
    // Covers the previously-uncovered success path (lines 44-49 of auth.ts):
    // a valid JWT with both email and name must surface as the AccessUser.
    // Without this test, a regression that swapped name/email or always
    // returned null would only fail in production behind CF Access.
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "alice@example.com", name: "Alice A." },
    });
    const fetch = await loadAuthApp();
    const res = await fetch(new Request("https://dove.hexly.ai/api/auth/me", { headers }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; name: string } };
    expect(body.user).toEqual({ email: "alice@example.com", name: "Alice A." });
    // Pin jwtVerify call args: token from CF header, options.audience
    // = CF_ACCESS_AUD, options.issuer = https://<team-domain>. A
    // regression that dropped `audience` would accept tokens issued
    // for OTHER applications in the same Access tenant (cross-app
    // token replay). A regression that dropped `issuer` would accept
    // tokens from OTHER team domains entirely. Both bypass IdP-level
    // tenant boundaries and are silent against payload-only tests.
    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    const jvArgs = mockJwtVerify.mock.calls[0] as unknown as [string, unknown, { audience: string; issuer: string }];
    expect(jvArgs[0]).toBe("x.y.z");
    expect(jvArgs[2].audience).toBe("test-aud");
    expect(jvArgs[2].issuer).toBe("https://myteam.cloudflareaccess.com");
    // Pin createRemoteJWKSet URL: must hit /cdn-cgi/access/certs on
    // the configured team domain. A regression that built the wrong
    // path (e.g. /openid-configuration) or wrong host (other team)
    // would still pass this test (mock returns {} regardless), so
    // we inspect the URL passed to defend against signing-key-source
    // drift. The route constructs `new URL('https://${teamDomain}/cdn-cgi/access/certs')`.
    const jwksUrl = ((mockCreateJWKS.mock.calls[0] as unknown as [URL] | undefined)?.[0] as URL | undefined)?.toString();
    expect(jwksUrl).toBe("https://myteam.cloudflareaccess.com/cdn-cgi/access/certs");
  });

  test("falls back to email when name claim missing", async () => {
    // Defensive default: if the IdP omits 'name', UI must still render
    // *something* (the email). A regression returning undefined would
    // crash React renderers downstream.
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "noname@example.com" },
    });
    const fetch = await loadAuthApp();
    const res = await fetch(new Request("https://dove.hexly.ai/api/auth/me", { headers }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; name: string } };
    expect(body.user.name).toBe("noname@example.com");
  });

  test("returns null user when payload has no email", async () => {
    // The 'no email in valid token' branch is distinct from invalid-JWT —
    // it must NOT throw; it must return null user (treated as signed-out).
    mockJwtVerify.mockResolvedValueOnce({ payload: {} });
    const fetch = await loadAuthApp();
    const res = await fetch(new Request("https://dove.hexly.ai/api/auth/me", { headers }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: null };
    expect(body.user).toBeNull();
  });
});

describe("auth-session middleware success branch (jose mocked)", () => {
  test("populates c.var.user and calls next() on valid JWT (lines 81-86)", async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "bob@example.com", name: "Bob" },
    });
    const fetch = await loadProtectedApp();
    const res = await fetch(
      new Request("https://dove.hexly.ai/api/projects", { headers }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; name: string } };
    // Critical: the downstream handler must see the authenticated user.
    // A regression that called next() WITHOUT setting c.var.user would
    // strip identity from every protected route.
    expect(body.user).toEqual({ email: "bob@example.com", name: "Bob" });
    // Same audience/issuer pin as #252 — mirror on middleware layer.
    // A regression in auth-session that dropped audience/issuer would
    // expose every protected route to cross-app/cross-team token replay.
    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    const jvArgs = mockJwtVerify.mock.calls[0] as unknown as [string, unknown, { audience: string; issuer: string }];
    expect(jvArgs[0]).toBe("x.y.z");
    expect(jvArgs[2].audience).toBe("test-aud");
    expect(jvArgs[2].issuer).toBe("https://myteam.cloudflareaccess.com");
  });

  test("rejects 401 when valid JWT has no email", async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { name: "noemail" } });
    const fetch = await loadProtectedApp();
    const res = await fetch(
      new Request("https://dove.hexly.ai/api/projects", { headers }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("populates user with name=email when name claim missing (line 88 ?? branch)", async () => {
    // Covers auth-session.ts:88 — (payload.name as string) ?? email.
    // A regression returning `undefined` for name would crash React
    // headers showing "Welcome, undefined" or similar nonsense; this
    // pin documents the email-as-name fallback contract.
    mockJwtVerify.mockResolvedValueOnce({
      payload: { email: "noname@example.com" },
    });
    const fetch = await loadProtectedApp();
    const res = await fetch(
      new Request("https://dove.hexly.ai/api/projects", { headers }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; name: string } };
    expect(body.user.email).toBe("noname@example.com");
    expect(body.user.name).toBe("noname@example.com");
  });
});
