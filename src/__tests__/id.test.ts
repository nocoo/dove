import { describe, expect, test } from "bun:test";
import { generateId, generateWebhookToken } from "@/lib/id";

describe("generateId", () => {
  test("returns a 21-character string", () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  test("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  test("uses only URL-safe characters", () => {
    const id = generateId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("generateWebhookToken", () => {
  test("returns a 48-character string", () => {
    const token = generateWebhookToken();
    expect(token).toHaveLength(48);
  });

  test("returns unique values", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateWebhookToken()));
    expect(tokens.size).toBe(100);
  });

  test("uses only URL-safe characters", () => {
    const token = generateWebhookToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
