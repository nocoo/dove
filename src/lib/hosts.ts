/**
 * Shared host validation for reverse-proxy headers.
 *
 * Prevents host-header injection by validating `x-forwarded-host`
 * against an explicit allowlist before trusting it.
 */

/** Parse ALLOWED_HOSTS from env — reads fresh on each call. */
function parseAllowedHosts(): Set<string> {
  return new Set(
    (process.env.ALLOWED_HOSTS ?? "localhost:7046")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  );
}

/**
 * Trusted hosts for the current request cycle.
 * Re-reads process.env on every access so tests can modify it via beforeEach.
 */
export const ALLOWED_HOSTS = {
  has(host: string): boolean {
    return parseAllowedHosts().has(host);
  },
};

/**
 * Build the base URL for the current request, respecting reverse-proxy
 * headers **only** when the forwarded host is in the allowlist.
 *
 * Falls back to the raw request URL origin when the header is missing
 * or untrusted.
 */
export function buildBaseUrl(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost && ALLOWED_HOSTS.has(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
