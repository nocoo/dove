/**
 * E2E: Auth API — GET /api/auth/me, GET /api/auth/signout
 *
 * Real HTTP against running dev server on port 17034.
 *
 * Dev mode is auto-detected by host=localhost, so /me returns the dev user
 * and /signout redirects to "/" (no CF Access team domain configured in tests).
 */
import { describe, expect, test } from "vitest";
import { get, parseJson } from "./helpers";

describe("GET /api/auth/me", () => {
  test("returns the dev user in dev mode (localhost)", async () => {
    const response = await get("/api/auth/me");
    expect(response.status).toBe(200);
    const body = await parseJson<{ user: { email: string; name: string } | null }>(response);
    expect(body.user).not.toBeNull();
    expect(body.user?.email).toBe("architie@gmail.com");
  });
});

describe("GET /api/auth/profile", () => {
  test("returns public name and avatar without email id or slug", async () => {
    const response = await get("/api/auth/profile");
    expect(response.status).toBe(200);
    const body = await parseJson<Record<string, unknown>>(response);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("slug");
    expect(body.name === null || typeof body.name === "string").toBe(true);
    expect(body.avatar === null || typeof body.avatar === "string").toBe(true);
  });
});

describe("GET /api/auth/signout", () => {
  test("redirects to root when no CF Access team domain is configured", async () => {
    // get() follows redirects; we want to inspect the redirect itself, so
    // we keep the same helper-style call pattern (route gate-friendly) but
    // assert that we either ended up on "/" or hit a redirect status.
    const response = await get("/api/auth/signout");
    // After following the redirect we land on the SPA root (200) — verify the
    // response is not a 5xx and the URL settled at "/" (final).
    expect(response.status).toBeLessThan(500);
    expect(new URL(response.url).pathname).toBe("/");
  });
});
