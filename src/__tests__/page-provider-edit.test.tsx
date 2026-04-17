/**
 * Page-level regression tests for the provider edit form.
 *
 * Guards the two interaction bugs called out in the C15 code review:
 *   1. api_key <input> must NOT be pre-filled with the masked secret —
 *      otherwise typing appends to "••••••abcd" instead of replacing it.
 *   2. Send Test button must NOT be disabled when the recipient field is
 *      blank — the backend documents empty-body as the happy path and
 *      falls back to session.user.email.
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock the heavy shell. AppShell drags in next/navigation's usePathname,
// SidebarProvider, TooltipProvider, etc. We only care about the form.
// ---------------------------------------------------------------------------
void mock.module("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// next/navigation — useRouter only used for redirects on delete success.
const push = mock(() => {});
void mock.module("next/navigation", () => ({
  useRouter: () => ({ push, back: () => {}, replace: () => {} }),
  usePathname: () => "/providers/prov_abc",
}));

// next-auth/react — page pre-fills recipient from session. Tests can
// swap `sessionEmail` to null to simulate "no prefill".
let sessionEmail: string | null = "admin@example.com";
void mock.module("next-auth/react", () => ({
  useSession: () => ({
    data: sessionEmail ? { user: { email: sessionEmail } } : null,
    status: sessionEmail ? "authenticated" : "unauthenticated",
  }),
}));

// sonner — swallow toasts.
const toastSuccess = mock(() => {});
const toastError = mock(() => {});
void mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Radix Select relies on pointerCapture which Happy DOM doesn't ship.
// Stub just enough so the tests can drive the underlying state.
// The edit page's Type <Select> isn't clicked in the scenarios below, so
// a no-op stub is fine — we only need the module to load without throwing.
void mock.module("@/components/ui/select", () => {
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: React.ReactNode;
    }) => (
      <select
        data-testid="stub-select"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => <option value={value}>{children}</option>,
    SelectValue: () => null,
  };
});

// Dialog — lightweight stub so confirm-delete test could work if needed.
void mock.module("@/components/ui/dialog", () => {
  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      onOpenChange: (v: boolean) => void;
      children: React.ReactNode;
    }) => (open ? <div role="dialog">{children}</div> : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

// ---------------------------------------------------------------------------
// Fetch mock — per-test handlers pushed onto a queue-ish dispatcher keyed
// by url+method. We use a plain function so each test can set its own.
// ---------------------------------------------------------------------------
let originalFetch: typeof globalThis.fetch;

interface RouteHandlers {
  [key: string]: (init?: RequestInit) => Promise<Response> | Response;
}

function installFetch(routes: RouteHandlers) {
  const fn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) {
      throw new Error(`Unhandled fetch: ${key}`);
    }
    return handler(init);
  };
  globalThis.fetch = fn as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Import after mocks are in place.
import ProviderEditPage from "@/app/providers/[id]/page";
import { Suspense } from "react";

beforeEach(() => {
  originalFetch = globalThis.fetch;
  toastSuccess.mockClear();
  toastError.mockClear();
  push.mockClear();
  sessionEmail = "admin@example.com";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

const baseRecord = {
  id: "prov_abc",
  name: "Main Resend",
  type: "resend" as const,
  domain: "mail.example.com",
  // The API returns the masked value — NOT the raw secret.
  config: { api_key: "••••••cdef" },
  created_at: "2026-03-28T12:00:00.000Z",
  updated_at: "2026-03-28T12:00:00.000Z",
};

// React's `use(promise)` suspends on first render. Build a synchronously-
// resolved "thenable" that use() treats as fulfilled without a re-render,
// so our Suspense boundary never actually mounts the fallback.
function resolvedParams(): Promise<{ id: string }> {
  const value = { id: "prov_abc" };
  const p = Promise.resolve(value) as Promise<{ id: string }> & {
    status?: string;
    value?: unknown;
  };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

function renderPage() {
  return render(
    <Suspense fallback={<div>loading</div>}>
      <ProviderEditPage params={resolvedParams()} />
    </Suspense>,
  );
}

describe("ProviderEditPage — api_key input does not bind masked value", () => {
  test("renders the masked value as a hint, not as input value", async () => {
    installFetch({
      "GET /api/providers/prov_abc": () => jsonResponse(baseRecord),
    });

    renderPage();

    const input = (await screen.findByLabelText("API Key")) as HTMLInputElement;
    // The masked secret must not end up inside the input's value — otherwise
    // typing appends to "••••••cdef".
    expect(input.value).toBe("");
    // But the user should still see a hint of what's currently stored.
    expect(input.placeholder).toContain("••••••cdef");
  });

  test("typing in API Key does not concatenate onto the masked value", async () => {
    installFetch({
      "GET /api/providers/prov_abc": () => jsonResponse(baseRecord),
    });

    renderPage();
    const input = (await screen.findByLabelText("API Key")) as HTMLInputElement;

    await userEvent.type(input, "re_newkey_1234567890");

    // Exactly what the user typed — no "••••••cdef" prefix.
    expect(input.value).toBe("re_newkey_1234567890");
  });
});

describe("ProviderEditPage — Send Test allows empty recipient", () => {
  test("button stays enabled when recipient is cleared; POST omits `to`", async () => {
    // Disable the session prefill so the recipient input starts blank —
    // without this, the page's useEffect re-fills it on every render.
    sessionEmail = null;
    let sentBody: unknown = "__not_called__";
    installFetch({
      "GET /api/providers/prov_abc": () => jsonResponse(baseRecord),
      "POST /api/providers/prov_abc/test-send": (init) => {
        sentBody = init?.body;
        return jsonResponse({ to: "admin@example.com", id: "msg_1" });
      },
    });

    renderPage();
    // Wait for load.
    await screen.findByLabelText("API Key");

    const recipient = (await screen.findByLabelText(
      "Recipient",
    )) as HTMLInputElement;
    expect(recipient.value).toBe("");

    const button = screen.getByRole("button", { name: /send test/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(button);

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });

    // Body must be `{}` — NOT include `to: ""`.
    expect(sentBody).toBe("{}");
  });

  test("custom recipient is forwarded verbatim", async () => {
    sessionEmail = null;
    let sentBody: unknown = null;
    installFetch({
      "GET /api/providers/prov_abc": () => jsonResponse(baseRecord),
      "POST /api/providers/prov_abc/test-send": (init) => {
        sentBody = init?.body;
        return jsonResponse({ to: "qa@example.com", id: "msg_2" });
      },
    });

    renderPage();
    await screen.findByLabelText("API Key");

    const recipient = (await screen.findByLabelText(
      "Recipient",
    )) as HTMLInputElement;
    fireEvent.change(recipient, { target: { value: "qa@example.com" } });
    expect(recipient.value).toBe("qa@example.com");

    await userEvent.click(screen.getByRole("button", { name: /send test/i }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(JSON.parse(sentBody as string)).toEqual({ to: "qa@example.com" });
  });
});

describe("ProviderEditPage — save requires re-typed api_key when config touches", () => {
  test("submitting with name-only change does NOT include config", async () => {
    let putBody: unknown = null;
    installFetch({
      "GET /api/providers/prov_abc": () => jsonResponse(baseRecord),
      "PUT /api/providers/prov_abc": (init) => {
        putBody = init?.body;
        return jsonResponse({ ...baseRecord, name: "Renamed" });
      },
    });

    renderPage();
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");

    await userEvent.click(
      screen.getByRole("button", { name: /save changes/i }),
    );

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    const payload = JSON.parse(putBody as string);
    expect(payload).toEqual({ name: "Renamed" });
    expect(payload).not.toHaveProperty("config");
  });
});
