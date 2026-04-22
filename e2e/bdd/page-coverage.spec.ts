import { test, expect } from "@playwright/test";

/**
 * Page-coverage smoke: every client route should at least load without
 * crashing, even if no real data is present. The L3 page coverage gate
 * (scripts/check-page-coverage.ts) treats a page.goto(...) as "this page
 * is exercised by L3" — these tests guarantee coverage for routes that
 * other specs only reach via clicks.
 *
 * Detail pages use a synthetic ID; we accept either the detail page
 * rendering or a 404-ish empty state, but require no console error.
 */

const PAGES: Array<{ path: string; label: string }> = [
  { path: "/projects/new", label: "New project page" },
  { path: "/projects/synthetic_smoke_id", label: "Project detail page" },
  { path: "/templates/new", label: "New template page" },
  { path: "/templates/synthetic_smoke_id", label: "Template detail page" },
  { path: "/providers", label: "Providers list page" },
  { path: "/providers/new", label: "New provider page" },
  { path: "/providers/synthetic_smoke_id", label: "Provider detail page" },
];

test.describe("Page coverage smoke", () => {
  for (const { path, label } of PAGES) {
    test(`${label} loads at ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const response = await page.goto(path);
      expect(response, `no response from ${path}`).not.toBeNull();
      // The SPA returns 200 for any path; the React router resolves it.
      expect(response?.status() ?? 0).toBeLessThan(500);
      // App shell must be present.
      await expect(page.locator("body")).toBeVisible();
      expect(errors, `console errors on ${path}: ${errors.join("; ")}`).toEqual([]);
    });
  }
});
