import { describe, expect, test } from "bun:test";
import { ALLOWED_HOSTS, buildBaseUrl } from "@/lib/hosts";

describe("ALLOWED_HOSTS", () => {
  test("includes localhost:7046 by default", () => {
    expect(ALLOWED_HOSTS.has("localhost:7046")).toBe(true);
  });

  test("rejects unknown hosts", () => {
    expect(ALLOWED_HOSTS.has("evil.com")).toBe(false);
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
