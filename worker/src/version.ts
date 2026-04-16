// Auto-resolved at build time by wrangler's bundler (esbuild).
// @ts-expect-error — JSON import handled by bundler
import pkg from "../../package.json";

export const APP_VERSION: string = (pkg as { version: string }).version;
