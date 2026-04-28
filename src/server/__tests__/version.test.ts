import { describe, test, expect } from "vitest";
import { APP_VERSION } from "../lib/version";

describe("server/lib/version", () => {
  test("APP_VERSION is a valid semver string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("APP_VERSION is defined", () => {
    expect(APP_VERSION).toBeDefined();
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
