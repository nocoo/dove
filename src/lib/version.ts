/**
 * Centralized app version constant.
 *
 * Injected at build time via vite.config.ts define from package.json.
 * Falls back to "0.0.0" when not set (e.g. in tests).
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
