import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { ALLOWED_HOSTS, buildBaseUrl } from "@/lib/hosts";

let savedAllowedHosts: string | undefined;

beforeEach(() => {
  savedAllowedHosts = process.env.ALLOWED_HOSTS;
  delete process.env.ALLOWED_HOSTS;
});

afterEach(() => {
  if (savedAllowedHosts !== undefined) {
    process.env.ALLOWED_HOSTS = savedAllowedHosts;
  } else {
    delete process.env.ALLOWED_HOSTS;
  }
});

describe("ALLOWED_HOSTS", () => {
  test("includes localhost:7046 by default", () => {
    expect(ALLOWED_HOSTS.has("localhost:7046")).toBe(true);
  });

  test("rejects unknown hosts", () => {
    expect(ALLOWED_HOSTS.has("evil.com")).toBe(false);
  });

  test("respects ALLOWED_HOSTS env var", () => {
    process.env.ALLOWED_HOSTS = "custom.example.com,other.example.com";
    expect(ALLOWED_HOSTS.has("custom.example.com")).toBe(true);
    expect(ALLOWED_HOSTS.has("other.example.com")).toBe(true);
    expect(ALLOWED_HOSTS.has("localhost:7046")).toBe(false);
  });
});

describe("buildBaseUrl", () => {
  test("uses x-forwarded-host when trusted", () => {
    const request = new Request("http://localhost:7046/test", {
      headers: {
        "x-forwarded-host": "localhost:7046",
        "x-forwarded-proto": "https",
      },
    });
    const url = buildBaseUrl(request);
    expect(url).toBe("https://localhost:7046");
  });

  test("falls back to request URL when x-forwarded-host is untrusted", () => {
    const request = new Request("http://localhost:7046/test", {
      headers: {
        "x-forwarded-host": "evil.com",
      },
    });
    const url = buildBaseUrl(request);
    expect(url).toBe("http://localhost:7046");
  });

  test("falls back to request URL when no x-forwarded-host", () => {
    const request = new Request("http://localhost:7046/test");
    const url = buildBaseUrl(request);
    expect(url).toBe("http://localhost:7046");
  });
});
