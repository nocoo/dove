import { describe, expect, test } from "bun:test";
import { generatePageNumbers } from "@/lib/pagination";

describe("generatePageNumbers", () => {
  test("returns all pages when total <= 7", () => {
    expect(generatePageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(generatePageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("shows ellipsis at end for early pages", () => {
    const result = generatePageNumbers(1, 10);
    expect(result[0]).toBe(1);
    expect(result).toContain("...");
    expect(result[result.length - 1]).toBe(10);
  });

  test("shows ellipsis at start for late pages", () => {
    const result = generatePageNumbers(10, 10);
    expect(result[0]).toBe(1);
    expect(result).toContain("...");
    expect(result[result.length - 1]).toBe(10);
  });

  test("shows ellipsis on both sides for middle pages", () => {
    const result = generatePageNumbers(5, 10);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(10);
    // Should have two "..." markers
    const ellipses = result.filter((p) => p === "...");
    expect(ellipses.length).toBe(2);
  });

  test("always includes first and last pages", () => {
    for (let current = 1; current <= 20; current++) {
      const result = generatePageNumbers(current, 20);
      expect(result[0]).toBe(1);
      expect(result[result.length - 1]).toBe(20);
    }
  });

  test("handles single page", () => {
    expect(generatePageNumbers(1, 1)).toEqual([1]);
  });
});
