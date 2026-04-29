import { describe, test, expect } from "vitest";
import pkg from "../../../package.json" with { type: "json" };
import { APP_VERSION } from "../lib/version";

describe("server/lib/version", () => {
  test("APP_VERSION is a valid semver string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("APP_VERSION matches package.json version (catches release drift)", () => {
    // The server version is hardcoded; this guards against forgetting to
    // bump it when package.json changes.
    expect(APP_VERSION).toBe(pkg.version);
  });
});
