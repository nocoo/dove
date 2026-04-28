import { describe, expect, test } from "vitest";
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
  test("accepts empty config", () => {
    const r = parseConfigForType("cloudflare", {});
    expect(r.success).toBe(true);
  });

  test("accepts config with extra fields (stripped)", () => {
    const r = parseConfigForType("cloudflare", { extra: "ignored" });
    expect(r.success).toBe(true);
  });
});
