import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("lib/email/resend (deprecated)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockFetch = vi.fn();

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe("sendEmail", () => {
    const emailParams = {
      from: "Test <test@example.com>",
      to: "user@example.com",
      subject: "Hello",
      html: "<p>World</p>",
      idempotencyKey: "key_123",
    };

    test("sends email using RESEND_API_KEY env", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg_legacy" }),
      });

      const { sendEmail } = await import("@/lib/email/resend");
      const result = await sendEmail(emailParams);

      expect(result.id).toBe("msg_legacy");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer re_test_key",
          }),
        }),
      );
    });

    test("throws when RESEND_API_KEY not set", async () => {
      delete process.env.RESEND_API_KEY;

      const { sendEmail } = await import("@/lib/email/resend");
      await expect(sendEmail(emailParams)).rejects.toThrow("RESEND_API_KEY not configured");
    });
  });
});
