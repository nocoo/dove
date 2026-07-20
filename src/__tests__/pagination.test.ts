import { describe, expect, test } from "vitest";
import { generatePageNumbers } from "@/lib/pagination";

describe("generatePageNumbers", () => {
	test("returns all pages when total <= 7", () => {
		expect(generatePageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(generatePageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	test("shows ellipsis at end for early pages", () => {
		// current=1 of 10 → [1, 2, "...", 10] (ellipsis on the trailing side only)
		expect(generatePageNumbers(1, 10)).toEqual([1, 2, "...", 10]);
	});

	test("shows ellipsis at start for late pages", () => {
		// current=10 of 10 → [1, "...", 9, 10] (ellipsis on the leading side only)
		expect(generatePageNumbers(10, 10)).toEqual([1, "...", 9, 10]);
	});

	test("shows ellipsis on both sides for middle pages", () => {
		// current=5 of 10 → [1, "...", 4, 5, 6, "...", 10]
		expect(generatePageNumbers(5, 10)).toEqual([1, "...", 4, 5, 6, "...", 10]);
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
