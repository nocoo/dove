import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    pool: "vmThreads",
    isolate: true,
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["node_modules/**", "e2e/**"],
    testTimeout: 10_000,
    alias: {
      "cloudflare:email": path.resolve(__dirname, "./src/__tests__/mocks/cloudflare-email.ts"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      skipFull: true,
      include: ["src/lib/**/*.ts", "src/server/lib/**/*.ts", "src/server/routes/**/*.ts", "src/server/middleware/**/*.ts", "src/server/index.ts"],
      exclude: [
        "node_modules/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.config.*",
        "**/*.d.ts",
        "src/__tests__/",
        "src/server/__tests__/",
        "src/client/",
        "src/components/",
        "src/hooks/",
        "src/routes/",
        "src/server/routes/db-init.ts",
      ],
      thresholds: {
        lines: 99,
        functions: 99,
        branches: 96,
        statements: 99,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
