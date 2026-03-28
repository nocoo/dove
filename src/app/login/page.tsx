"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const handleGoogleLogin = () => {
    signIn("google", { callbackUrl: "/" });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 overflow-hidden">
      {/* Radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 70% 55% at 50% 50%,",
            "hsl(var(--foreground) / 0.045) 0%,",
            "hsl(var(--foreground) / 0.042) 10%,",
            "hsl(var(--foreground) / 0.036) 20%,",
            "hsl(var(--foreground) / 0.028) 32%,",
            "hsl(var(--foreground) / 0.020) 45%,",
            "hsl(var(--foreground) / 0.012) 58%,",
            "hsl(var(--foreground) / 0.006) 72%,",
            "hsl(var(--foreground) / 0.002) 86%,",
            "transparent 100%)",
          ].join(" "),
        }}
      />

      <div className="flex flex-col items-center">
        <div className="w-full max-w-sm rounded-2xl bg-card p-8 ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
          style={{
            boxShadow: [
              "0 1px 2px rgba(0,0,0,0.06)",
              "0 4px 8px rgba(0,0,0,0.04)",
              "0 12px 24px rgba(0,0,0,0.06)",
              "0 24px 48px rgba(0,0,0,0.04)",
            ].join(", "),
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold">
              D
            </div>
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Dove
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Email relay service
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive text-center">
              {error === "AccessDenied"
                ? "Sorry, your account is not authorized to access this app."
                : "Login failed. Please try again."}
            </div>
          )}

          {/* Divider */}
          <div className="mt-6 h-px w-full bg-border" />

          {/* Google Sign-in button */}
          <button
            onClick={handleGoogleLogin}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </button>

          {/* Terms */}
          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Access is restricted to authorized accounts only
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
