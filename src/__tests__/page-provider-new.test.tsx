/**
 * Page-level test for /providers/new. Guards the "worker_url only for
 * cloudflare" conditional — a regression would show up as either an always-
 * visible worker field or a missing one for CF. We drive the type via the
 * stubbed native select and check the form submission shape.
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

void mock.module("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const push = mock(() => {});
void mock.module("next/navigation", () => ({
  useRouter: () => ({ push, back: () => {}, replace: () => {} }),
  usePathname: () => "/providers/new",
}));

const toastSuccess = mock(() => {});
const toastError = mock(() => {});
void mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

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

import NewProviderPage from "@/app/providers/new/page";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  toastSuccess.mockClear();
  toastError.mockClear();
  push.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("NewProviderPage", () => {
  test("worker_url field only appears for cloudflare type", async () => {
    render(<NewProviderPage />);

    // Initially resend → no worker URL field.
    expect(screen.queryByLabelText("Worker URL")).toBeNull();

    const select = screen.getByTestId("stub-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "cloudflare" } });

    expect(await screen.findByLabelText("Worker URL")).toBeDefined();
  });

  test("submits resend payload without worker_url", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "/api/providers" && init?.method === "POST") {
        sentBody = init.body;
        return new Response(JSON.stringify({ id: "prov_new1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof globalThis.fetch;

    render(<NewProviderPage />);

    await userEvent.type(screen.getByLabelText("Name"), "Prod Resend");
    await userEvent.type(
      screen.getByLabelText("Sending Domain"),
      "mail.example.com",
    );
    await userEvent.type(
      screen.getByLabelText("API Key"),
      "re_test_12345",
    );

    await userEvent.click(
      screen.getByRole("button", { name: /create provider/i }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/providers/prov_new1");
    });

    const payload = JSON.parse(sentBody as string);
    expect(payload).toEqual({
      name: "Prod Resend",
      type: "resend",
      domain: "mail.example.com",
      config: { api_key: "re_test_12345" },
    });
    // Critical: resend config should not carry worker_url.
    expect(payload.config).not.toHaveProperty("worker_url");
  });
});
