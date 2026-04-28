import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ResendProvider } from "@/lib/email/providers/resend";

describe("ResendProvider", () => {
  let provider: ResendProvider;
  const mockFetch = vi.fn();

  beforeEach(() => {
    provider = new ResendProvider("re_test_key");
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor and properties", () => {
    test("has type resend", () => {
      expect(provider.type).toBe("resend");
    });

    test("supportsDryRun returns true", () => {
      expect(provider.supportsDryRun()).toBe(true);
    });
  });

  describe("setDryRun", () => {
    test("enables dry run mode", () => {
      provider.setDryRun(true);
      // Verify by calling send - it should return dry_run_ prefixed id
    });
  });

  describe("send", () => {
    const sendParams = {
      from: "Test <test@example.com>",
      to: "user@example.com",
      subject: "Hello",
      html: "<p>World</p>",
      idempotencyKey: "key_123",
    };

    test("sends email successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg_abc123" }),
      });

      const result = await provider.send(sendParams);
      expect(result.id).toBe("msg_abc123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer re_test_key",
            "Content-Type": "application/json",
            "Idempotency-Key": "key_123",
          }),
        }),
      );
    });

    test("returns synthetic id in dry run mode", async () => {
      provider.setDryRun(true);
      const result = await provider.send(sendParams);
      expect(result.id).toMatch(/^dry_run_/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("retries on network error", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg_retry" }),
        });

      const result = await provider.send(sendParams);
      expect(result.id).toBe("msg_retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("retries on 409 conflict", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 409 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg_after_409" }),
        });

      const result = await provider.send(sendParams);
      expect(result.id).toBe("msg_after_409");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("retries on 5xx error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "msg_after_5xx" }),
        });

      const result = await provider.send(sendParams);
      expect(result.id).toBe("msg_after_5xx");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("throws on 4xx error without retry", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      await expect(provider.send(sendParams)).rejects.toThrow("Resend API error: 400");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("throws after max retries on persistent network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(provider.send(sendParams)).rejects.toThrow("Network error");
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    test("throws after max retries on persistent 5xx", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("Service Unavailable"),
      });

      await expect(provider.send(sendParams)).rejects.toThrow("Resend API error: 503");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});
