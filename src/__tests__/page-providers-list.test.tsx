/**
 * Page-level test for /providers list — verifies three-state HealthBadge
 * renders based on /health responses.
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

void mock.module("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const push = mock(() => {});
void mock.module("next/navigation", () => ({
  useRouter: () => ({ push, back: () => {}, replace: () => {} }),
  usePathname: () => "/providers",
}));

const toastError = mock(() => {});
void mock.module("sonner", () => ({
  toast: { success: () => {}, error: toastError },
}));

// Next/Link accessor — next/link's default export is fine under happy-dom,
// but keep a shim just in case it tries to prefetch.
void mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ProvidersPage from "@/app/providers/page";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  push.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

function installFetch(
  providers: Array<{
    id: string;
    name: string;
    type: string;
    domain: string;
    config: Record<string, string>;
    created_at: string;
    updated_at: string;
  }>,
  healthById: Record<string, unknown>,
): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/providers") {
      return new Response(JSON.stringify(providers), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const m = url.match(/\/api\/providers\/([^/]+)\/health$/);
    if (m) {
      const id = m[1]!;
      return new Response(JSON.stringify(healthById[id]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof globalThis.fetch;
}

describe("ProvidersPage — health badges", () => {
  test("renders healthy / unreachable / invalid-config states side by side", async () => {
    installFetch(
      [
        {
          id: "p1",
          name: "Healthy CF",
          type: "cloudflare",
          domain: "mail.example.com",
          config: { api_key: "••••••abcd", worker_url: "https://w.example" },
          created_at: "2026-03-28T12:00:00.000Z",
          updated_at: "2026-03-28T12:00:00.000Z",
        },
        {
          id: "p2",
          name: "Down Resend",
          type: "resend",
          domain: "mail2.example.com",
          config: { api_key: "••••••wxyz" },
          created_at: "2026-03-28T12:00:00.000Z",
          updated_at: "2026-03-28T12:00:00.000Z",
        },
        {
          id: "p3",
          name: "Broken Resend",
          type: "resend",
          domain: "mail3.example.com",
          config: { api_key: "••••••zzzz" },
          created_at: "2026-03-28T12:00:00.000Z",
          updated_at: "2026-03-28T12:00:00.000Z",
        },
      ],
      {
        p1: {
          healthy: true,
          configValid: true,
          configError: null,
          reachable: true,
          reachableError: null,
          checkedAt: "2026-03-28T12:00:00.000Z",
        },
        p2: {
          healthy: false,
          configValid: true,
          configError: null,
          reachable: false,
          reachableError: "timeout",
          checkedAt: "2026-03-28T12:00:00.000Z",
        },
        p3: {
          healthy: false,
          configValid: false,
          configError: "missing api_key",
          reachable: null,
          reachableError: null,
          checkedAt: "2026-03-28T12:00:00.000Z",
        },
      },
    );

    render(<ProvidersPage />);

    // All three names appear once the list resolves.
    expect(await screen.findByText("Healthy CF")).toBeDefined();
    expect(await screen.findByText("Down Resend")).toBeDefined();
    expect(await screen.findByText("Broken Resend")).toBeDefined();

    // Wait for the health state labels.
    await waitFor(() => {
      expect(screen.getByText("Healthy")).toBeDefined();
      expect(screen.getByText("Unreachable")).toBeDefined();
      expect(screen.getByText("Invalid config")).toBeDefined();
    });
  });
});
