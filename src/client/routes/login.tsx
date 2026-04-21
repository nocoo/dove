import { useSearchParams } from "react-router";

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "Your email is not on the allowed list.",
  no_email: "Could not retrieve your email from Google.",
};

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get("error");
  const message = error ? ERROR_MESSAGES[error] : null;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-bold">Dove</h1>
        {message && (
          <p className="text-sm text-destructive">{message}</p>
        )}
        <a
          href="/api/auth/google"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
