import { describe, expect, test } from "vitest";
import { APP_VERSION } from "@/lib/version";

describe("version", () => {
  test("APP_VERSION falls back to 0.0.0 in test env", () => {
    expect(APP_VERSION).toBe("0.0.0");
  });

  test("APP_VERSION is a non-empty string", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  test("APP_VERSION matches semver format", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
