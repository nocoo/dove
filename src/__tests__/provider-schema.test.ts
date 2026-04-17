import { describe, expect, test } from "bun:test";
import { parseConfigForType } from "@/lib/email/provider-schema";

describe("parseConfigForType(resend)", () => {
  test("accepts valid api_key", () => {
    const r = parseConfigForType("resend", { api_key: "re_abc" });
    expect(r.success).toBe(true);
  });

  test("rejects missing api_key", () => {
    const r = parseConfigForType("resend", {});
    expect(r.success).toBe(false);
  });

  test("rejects empty api_key", () => {
    const r = parseConfigForType("resend", { api_key: "" });
    expect(r.success).toBe(false);
  });
});

describe("parseConfigForType(cloudflare)", () => {
  test("accepts valid api_key + worker_url", () => {
    const r = parseConfigForType("cloudflare", {
      api_key: "cf_abc",
      worker_url: "https://w.example.com",
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing worker_url", () => {
    const r = parseConfigForType("cloudflare", { api_key: "cf_abc" });
    expect(r.success).toBe(false);
  });

  test("rejects worker_url that is not a URL", () => {
    const r = parseConfigForType("cloudflare", {
      api_key: "cf_abc",
      worker_url: "not a url",
    });
    expect(r.success).toBe(false);
  });

  test("rejects missing api_key", () => {
    const r = parseConfigForType("cloudflare", {
      worker_url: "https://w.example.com",
    });
    expect(r.success).toBe(false);
  });
});
