import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch } from "./helpers";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_api_key";
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sendEmail", () => {
  const params = {
    from: "Test <noreply@test.com>",
    to: "user@example.com",
    subject: "Test Subject",
    html: "<h1>Hello</h1>",
    idempotencyKey: "slog_123456",
  };

  test("sends email to Resend API and returns ID", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    globalThis.fetch = mockFetch(async (input, init) => {
      capturedUrl = input as string;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: "resend_msg_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { sendEmail } = await import("@/lib/email/resend");
    const result = await sendEmail(params);

    expect(capturedUrl).toBe("https://api.resend.com/emails");
    expect(capturedHeaders["Authorization"]).toBe("Bearer re_test_api_key");
    expect(capturedHeaders["Idempotency-Key"]).toBe("slog_123456");

    const body = JSON.parse(capturedBody) as { from: string; to: string[]; subject: string };
    expect(body.from).toBe(params.from);
    expect(body.to).toEqual([params.to]);
    expect(body.subject).toBe(params.subject);
    expect(result.id).toBe("resend_msg_123");
  });

  test("throws when RESEND_API_KEY not configured", async () => {
    delete process.env.RESEND_API_KEY;

    const { sendEmail } = await import("@/lib/email/resend");
    await expect(sendEmail(params)).rejects.toThrow("RESEND_API_KEY not configured");
  });

  test("throws on 4xx error without retrying", async () => {
    let fetchCount = 0;
    globalThis.fetch = mockFetch(async () => {
      fetchCount++;
      return new Response(JSON.stringify({ error: "Invalid address" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    });

    const { sendEmail } = await import("@/lib/email/resend");
    await expect(sendEmail(params)).rejects.toThrow("Resend API error: 422");
    expect(fetchCount).toBe(1); // No retries
  });

  test("retries on 5xx and eventually succeeds", async () => {
    let fetchCount = 0;
    globalThis.fetch = mockFetch(async () => {
      fetchCount++;
      if (fetchCount <= 2) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify({ id: "resend_retry_ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { sendEmail } = await import("@/lib/email/resend");
    const result = await sendEmail(params);
    expect(result.id).toBe("resend_retry_ok");
    expect(fetchCount).toBe(3);
  }, 10000);

  test("retries on network error and eventually succeeds", async () => {
    let fetchCount = 0;
    globalThis.fetch = mockFetch(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        throw new Error("Network failure");
      }
      return new Response(JSON.stringify({ id: "resend_after_net_err" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { sendEmail } = await import("@/lib/email/resend");
    const result = await sendEmail(params);
    expect(result.id).toBe("resend_after_net_err");
    expect(fetchCount).toBe(2);
  }, 10000);

  test("retries on 409 concurrent idempotent request", async () => {
    let fetchCount = 0;
    globalThis.fetch = mockFetch(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "concurrent_idempotent_requests" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "resend_after_409" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { sendEmail } = await import("@/lib/email/resend");
    const result = await sendEmail(params);
    expect(result.id).toBe("resend_after_409");
    expect(fetchCount).toBe(2);
  }, 10000);
});
