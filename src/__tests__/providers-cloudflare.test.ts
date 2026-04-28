import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  CloudflareProvider,
  IdempotentSendResult,
  extractName,
  extractAddress,
} from "@/lib/email/providers/cloudflare";

describe("CloudflareProvider", () => {
  const mockSend = vi.fn();
  const mockBinding = { send: mockSend } as unknown as SendEmail;

  const sendParams = {
    from: "Test User <test@example.com>",
    to: "user@example.com",
    subject: "Hello",
    html: "<p>World</p>",
    idempotencyKey: "key_123",
  };

  beforeEach(() => {
    mockSend.mockReset();
  });

  describe("constructor and properties", () => {
    test("has type cloudflare", () => {
      const provider = new CloudflareProvider(mockBinding);
      expect(provider.type).toBe("cloudflare");
    });

    test("supportsDryRun returns false", () => {
      const provider = new CloudflareProvider(mockBinding);
      expect(provider.supportsDryRun()).toBe(false);
    });

    test("setDryRun is a no-op", () => {
      const provider = new CloudflareProvider(mockBinding);
      expect(() => provider.setDryRun()).not.toThrow();
    });
  });

  describe("send without D1", () => {
    test("sends email successfully", async () => {
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);

      const result = await provider.send(sendParams);
      expect(result.id).toBe("key_123");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test("throws on send failure", async () => {
      mockSend.mockRejectedValueOnce(new Error("Send failed"));
      const provider = new CloudflareProvider(mockBinding);

      await expect(provider.send(sendParams)).rejects.toThrow("Send failed");
    });
  });

  describe("send with D1 idempotency", () => {
    const mockPrepare = vi.fn();
    const mockBind = vi.fn();
    const mockRun = vi.fn();
    const mockFirst = vi.fn();

    const mockDb = {
      prepare: mockPrepare,
    } as unknown as D1Database;

    beforeEach(() => {
      mockPrepare.mockReset();
      mockBind.mockReset();
      mockRun.mockReset();
      mockFirst.mockReset();
      mockPrepare.mockReturnValue({ bind: mockBind });
      mockBind.mockReturnValue({ run: mockRun, first: mockFirst });
    });

    test("acquires fresh slot and sends", async () => {
      mockRun.mockResolvedValueOnce({ meta: { changes: 1 } }); // INSERT succeeds
      mockRun.mockResolvedValueOnce({ meta: { changes: 1 } }); // UPDATE to sent
      mockSend.mockResolvedValueOnce(undefined);

      const provider = new CloudflareProvider(mockBinding, mockDb);
      const result = await provider.send(sendParams);

      expect(result.id).toBe("key_123");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test("throws IdempotentSendResult when already sent", async () => {
      mockRun.mockResolvedValueOnce({ meta: { changes: 0 } }); // INSERT ignored (exists)
      mockFirst.mockResolvedValueOnce({ status: "sent" });

      const provider = new CloudflareProvider(mockBinding, mockDb);

      await expect(provider.send(sendParams)).rejects.toThrow(IdempotentSendResult);
    });

    test("throws on concurrent pending send", async () => {
      mockRun.mockResolvedValueOnce({ meta: { changes: 0 } }); // INSERT ignored
      mockFirst.mockResolvedValueOnce({ status: "pending" });

      const provider = new CloudflareProvider(mockBinding, mockDb);

      await expect(provider.send(sendParams)).rejects.toThrow("Concurrent send");
    });

    test("reclaims failed slot for retry", async () => {
      mockRun
        .mockResolvedValueOnce({ meta: { changes: 0 } }) // INSERT ignored
        .mockResolvedValueOnce({ meta: { changes: 1 } }) // UPDATE to pending (reclaim)
        .mockResolvedValueOnce({ meta: { changes: 1 } }); // UPDATE to sent
      mockFirst.mockResolvedValueOnce({ status: "failed" });
      mockSend.mockResolvedValueOnce(undefined);

      const provider = new CloudflareProvider(mockBinding, mockDb);
      const result = await provider.send(sendParams);

      expect(result.id).toBe("key_123");
    });

    test("updates to failed on send error", async () => {
      mockRun
        .mockResolvedValueOnce({ meta: { changes: 1 } }) // INSERT succeeds
        .mockResolvedValueOnce({ meta: { changes: 1 } }); // UPDATE to failed
      mockSend.mockRejectedValueOnce(new Error("Send failed"));

      const provider = new CloudflareProvider(mockBinding, mockDb);

      await expect(provider.send(sendParams)).rejects.toThrow("Send failed");
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("status = 'failed'"),
      );
    });

    test("handles race condition where row disappears", async () => {
      mockRun
        .mockResolvedValueOnce({ meta: { changes: 0 } }) // INSERT ignored
        .mockResolvedValueOnce({ meta: { changes: 1 } }); // UPDATE to sent
      mockFirst.mockResolvedValueOnce(null); // Row disappeared
      mockSend.mockResolvedValueOnce(undefined);

      const provider = new CloudflareProvider(mockBinding, mockDb);
      const result = await provider.send(sendParams);

      expect(result.id).toBe("key_123");
    });
  });
});

describe("IdempotentSendResult", () => {
  test("has correct name and message", () => {
    const err = new IdempotentSendResult("key_abc");
    expect(err.name).toBe("IdempotentSendResult");
    expect(err.message).toBe("Idempotent duplicate: already sent");
    expect(err.idempotencyKey).toBe("key_abc");
  });
});

describe("extractName", () => {
  test("extracts name from full format", () => {
    expect(extractName("Test User <test@example.com>")).toBe("Test User");
  });

  test("extracts name with extra spaces", () => {
    expect(extractName("  Test User   <test@example.com>")).toBe("Test User");
  });

  test("returns empty for email-only format", () => {
    expect(extractName("test@example.com")).toBe("");
  });

  test("returns empty for bare email in brackets", () => {
    expect(extractName("<test@example.com>")).toBe("");
  });
});

describe("extractAddress", () => {
  test("extracts address from full format", () => {
    expect(extractAddress("Test User <test@example.com>")).toBe("test@example.com");
  });

  test("extracts address with spaces", () => {
    expect(extractAddress("Test <  test@example.com  >")).toBe("test@example.com");
  });

  test("returns email-only as-is", () => {
    expect(extractAddress("test@example.com")).toBe("test@example.com");
  });

  test("trims whitespace from email-only", () => {
    expect(extractAddress("  test@example.com  ")).toBe("test@example.com");
  });
});
