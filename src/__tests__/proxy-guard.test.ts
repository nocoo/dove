/**
 * Tests for the E2E auth bypass guard logic in src/proxy.ts.
 *
 * The actual SKIP_AUTH constant is:
 *   process.env.E2E_SKIP_AUTH === "true" && process.env.NODE_ENV !== "production"
 *
 * We test this condition as a pure function to avoid importing NextAuth
 * dependencies. The proxy module itself is integration-tested via L2/L3 E2E.
 */

import { describe, expect, test } from "bun:test";

/** Mirrors the SKIP_AUTH condition from src/proxy.ts */
function shouldSkipAuth(env: {
  E2E_SKIP_AUTH?: string;
  NODE_ENV?: string;
}): boolean {
  return env.E2E_SKIP_AUTH === "true" && env.NODE_ENV !== "production";
}

describe("E2E auth bypass guard", () => {
  test("blocks bypass in production even if E2E_SKIP_AUTH=true", () => {
    expect(
      shouldSkipAuth({ E2E_SKIP_AUTH: "true", NODE_ENV: "production" }),
    ).toBe(false);
  });

  test("allows bypass in development with E2E_SKIP_AUTH=true", () => {
    expect(
      shouldSkipAuth({ E2E_SKIP_AUTH: "true", NODE_ENV: "development" }),
    ).toBe(true);
  });

  test("allows bypass in test with E2E_SKIP_AUTH=true", () => {
    expect(
      shouldSkipAuth({ E2E_SKIP_AUTH: "true", NODE_ENV: "test" }),
    ).toBe(true);
  });

  test("blocks bypass when E2E_SKIP_AUTH is not set", () => {
    expect(shouldSkipAuth({ NODE_ENV: "development" })).toBe(false);
  });

  test("blocks bypass when E2E_SKIP_AUTH is '1' (wrong value)", () => {
    expect(
      shouldSkipAuth({ E2E_SKIP_AUTH: "1", NODE_ENV: "development" }),
    ).toBe(false);
  });

  test("blocks bypass when both are unset", () => {
    expect(shouldSkipAuth({})).toBe(false);
  });
});
