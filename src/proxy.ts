import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ALLOWED_HOSTS } from "@/lib/hosts";

// Skip auth in E2E test environment (never in production)
const SKIP_AUTH =
  process.env.E2E_SKIP_AUTH === "true" &&
  process.env.NODE_ENV !== "production";

// Build redirect URL respecting reverse proxy headers
function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost && ALLOWED_HOSTS.has(forwardedHost)) {
    return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
  }

  return new URL(pathname, req.nextUrl.origin);
}

// Next.js 16 proxy convention (replaces middleware.ts)
const authHandler = auth((req) => {
  // Skip auth check in E2E test environment
  if (SKIP_AUTH) {
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/login";
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isLiveRoute = pathname === "/api/live";
  const isWebhookRoute = pathname.startsWith("/api/webhook");

  // Allow public routes: auth handlers, health check, webhook endpoints
  if (isAuthRoute || isLiveRoute || isWebhookRoute) {
    return NextResponse.next();
  }

  // Redirect to home if logged in and trying to access login page
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/"));
  }

  // Redirect to login if not logged in and trying to access protected page
  if (!isLoginPage && !isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/login"));
  }

  return NextResponse.next();
});

// Export as named 'proxy' function for Next.js 16
export function proxy(request: NextRequest) {
  return authHandler(request, {} as never);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$).*)",
  ],
};
