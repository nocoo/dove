import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  define: {
    "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(pkg.version),
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
