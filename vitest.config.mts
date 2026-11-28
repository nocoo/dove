import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		allowOnly: false,
		passWithNoTests: false,
		environment: "node",
		globals: true,
		pool: "vmThreads",
		isolate: true,
		include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
		exclude: ["node_modules/**", "e2e/**"],
		testTimeout: 10_000,
		alias: {
			"cloudflare:email": path.resolve(
				import.meta.dirname,
				"./src/__tests__/mocks/cloudflare-email.ts",
			),
		},
		coverage: {
			provider: "v8",
			// AST-aware remapping is built into vitest v4+; no opt-in needed.
			reporter: ["text", "json"],
			skipFull: true,
			include: [
				"src/lib/**/*.ts",
				"src/server/lib/**/*.ts",
				"src/server/routes/**/*.ts",
				"src/server/middleware/**/*.ts",
				"src/server/index.ts",
			],
			exclude: [
				// Third-party dependencies — never our code to cover.
				"node_modules/",
				// Test files themselves are not subject to coverage.
				"**/*.test.ts",
				"**/*.spec.ts",
				// Build/tool configuration files contain no runtime logic worth covering.
				"**/*.config.*",
				// Type declaration files and pure type modules have no executable code.
				"**/*.d.ts",
				"src/lib/types/**",
				// Test fixtures, mocks, and helpers — exercised indirectly by tests.
				"src/__tests__/",
				"src/server/__tests__/",
				/*
				 * Client-side code (UI layer) is covered by Playwright E2E tests
				 * under e2e/ rather than vitest unit tests.
				 */
				"src/client/",
				"src/components/",
				"src/hooks/",
				"src/routes/",
				/*
				 * db-init.ts is a one-shot bootstrap script run manually during
				 * deployment; covered by integration smoke tests in e2e/.
				 */
				"src/server/routes/db-init.ts",
			],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 85,
				statements: 90,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
});
