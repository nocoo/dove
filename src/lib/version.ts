/**
 * Centralized app version constant.
 *
 * Injected at build time via next.config.ts from package.json.
 * Falls back to "0.0.0" when the env var is not set (e.g. in tests).
 */
export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
