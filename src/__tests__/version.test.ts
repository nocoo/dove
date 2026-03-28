import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "@/lib/version";

describe("version", () => {
  test("APP_VERSION reads from NEXT_PUBLIC_APP_VERSION env", () => {
    // next.config.ts injects NEXT_PUBLIC_APP_VERSION at build time;
    // in test env the env var may or may not be set.
    const expected = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
    expect(APP_VERSION).toBe(expected);
  });

  test("APP_VERSION is a non-empty string", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  test("APP_VERSION matches semver format", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
