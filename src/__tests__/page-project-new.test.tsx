/**
 * Page-level test for /projects/new — guards the provider selector's
 * __legacy__ sentinel → omitted provider_id mapping.
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
  usePathname: () => "/projects/new",
}));

const toastSuccess = mock(() => {});
const toastError = mock(() => {});
void mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

void mock.module("@/components/ui/select", () => {
  // Track the id from SelectTrigger so the native <select> inherits it,
  // preserving <label htmlFor="...">-to-control association.
  let lastTriggerId: string | undefined;
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
        id={lastTriggerId}
        data-testid="stub-select"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    ),
    SelectTrigger: ({
      id,
      children,
    }: {
      id?: string;
      children: React.ReactNode;
    }) => {
      lastTriggerId = id;
      return <>{children}</>;
    },
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

import NewProjectPage from "@/app/projects/new/page";

let originalFetch: typeof globalThis.fetch;

const providerOptions = [
  {
    id: "prov_abc",
    name: "Main Resend",
    type: "resend",
    domain: "mail.example.com",
  },
];

function installFetch(
  onProjectPost: (body: string | null) => Response,
): void {
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
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/providers" && method === "GET") {
      return new Response(JSON.stringify(providerOptions), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "/api/projects" && method === "POST") {
      return onProjectPost((init?.body as string) ?? null);
    }
    throw new Error(`Unexpected ${method} ${url}`);
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

async function fillRequiredFields(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Name"), "Proj A");
  await userEvent.type(screen.getByLabelText("Email Prefix"), "noreply");
  await userEvent.type(
    screen.getByLabelText("Sender Display Name"),
    "Proj A",
  );
}

describe("NewProjectPage — provider selector", () => {
  test("legacy sentinel omits provider_id from payload", async () => {
    let bodyStr: string | null = null;
    installFetch((body) => {
      bodyStr = body;
      return new Response(
        JSON.stringify({ id: "proj_1", webhook_token: "tok_x" }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    });

    render(<NewProjectPage />);
    await screen.findByTestId("stub-select");
    await fillRequiredFields();

    await userEvent.click(
      screen.getByRole("button", { name: /create project/i }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/projects/proj_1");
    });

    const payload = JSON.parse(bodyStr ?? "{}");
    expect(payload).not.toHaveProperty("provider_id");
  });

  test("selecting a provider sends provider_id", async () => {
    let bodyStr: string | null = null;
    installFetch((body) => {
      bodyStr = body;
      return new Response(
        JSON.stringify({ id: "proj_2", webhook_token: "tok_y" }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    });

    render(<NewProjectPage />);
    await screen.findByTestId("stub-select");
    await fillRequiredFields();

    // Wait for providers list to hydrate before switching.
    await waitFor(() => {
      const select = screen.getByTestId("stub-select") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
    });

    const select = screen.getByTestId("stub-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "prov_abc" } });

    await userEvent.click(
      screen.getByRole("button", { name: /create project/i }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/projects/proj_2");
    });

    const payload = JSON.parse(bodyStr ?? "{}");
    expect(payload.provider_id).toBe("prov_abc");
  });
});
