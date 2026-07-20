import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	plugins: [react()],
	root: "src/client",
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
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
