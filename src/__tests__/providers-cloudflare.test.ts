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
    test("sends email successfully — verifies actual MIME envelope (from/to/subject/body)", async () => {
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);

      const result = await provider.send(sendParams);
      expect(result.id).toBe("key_123");
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Pre-strengthening, this only checked result.id + call count —
      // a regression building an EMPTY MIME (or one addressed to a
      // hardcoded debug address) would silently pass. Verify the
      // EmailMessage actually carries the right envelope + body.
      const msg = mockSend.mock.calls[0]?.[0] as { from: string; to: string; raw: string };
      // Envelope MUST use the bare address (extractAddress strips display name).
      expect(msg.from).toBe("test@example.com");
      expect(msg.to).toBe("user@example.com");
      // Raw MIME headers carry the full From with display name.
      expect(msg.raw).toMatch(/From: Test User <test@example.com>/);
      expect(msg.raw).toMatch(/To: user@example.com/);
      expect(msg.raw).toMatch(/Subject: Hello/);
      // Body must be present in the multipart payload — not just headers.
      expect(msg.raw).toContain("<p>World</p>");
    });

    test("throws on send failure", async () => {
      mockSend.mockRejectedValueOnce(new Error("Send failed"));
      const provider = new CloudflareProvider(mockBinding);

      await expect(provider.send(sendParams)).rejects.toThrow("Send failed");
      // Pin: send was attempted EXACTLY ONCE. CF provider has NO
      // built-in retry policy unlike Resend; a regression that silently
      // retried would double-deliver if the first send succeeded
      // server-side but threw due to e.g. response parsing.
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Pin the EmailMessage envelope was constructed from sendParams
      // (not e.g. some debug fallback). The single attempt must have
      // built the right MIME envelope.
      const msg = mockSend.mock.calls[0]?.[0] as { to: string };
      expect(msg.to).toBe("user@example.com");
    });

    test("RFC 2047-encodes non-ASCII Subject and From name; leaves ASCII as-is", async () => {
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "Café Owner <owner@example.com>",
        to: "user@example.com",
        subject: "こんにちは",
        html: "<p>hi</p>",
        idempotencyKey: "key_utf8",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { from: string; to: string; raw: string };
      // Non-ASCII subject must be wrapped with =?UTF-8?B?...?=
      expect(msg.raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
      // Non-ASCII display name ("Café Owner") must also be encoded inside angle brackets.
      expect(msg.raw).toMatch(/From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <owner@example\.com>/);
      // Decoding the base64 yields the original UTF-8 string.
      const m = msg.raw.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
      expect(m).not.toBeNull();
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(m![1]!), (c) => c.charCodeAt(0)),
      );
      expect(decoded).toBe("こんにちは");
    });

    test("leaves pure-ASCII Subject unchanged (no RFC 2047 wrapper)", async () => {
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "Test <test@example.com>",
        to: "user@example.com",
        subject: "Plain ASCII Subject",
        html: "<p>hi</p>",
        idempotencyKey: "key_ascii",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { raw: string };
      expect(msg.raw).toContain("Subject: Plain ASCII Subject\r\n");
      expect(msg.raw).not.toContain("=?UTF-8?B?");
    });

    test("DEFENSE: CR/LF in Subject triggers RFC 2047 base64 (blocks header injection)", async () => {
      // CRITICAL header-injection defense: the printable-ASCII regex
      // `\x20-\x7E` excludes CR (0x0D) and LF (0x0A), so any subject
      // containing them gets base64-encoded. WITHOUT this property,
      // a subject like `"Hi\r\nBcc: attacker@evil.com"` would inject
      // a Bcc header into the outbound MIME envelope (silent data
      // exfiltration to attacker recipients).
      //
      // A regression that "optimized" the printable check to use
      // /^[\u0020-\u007E]*$/u with /s flag (matching control chars)
      // OR replaced the regex with a Unicode-only check (e.g.
      // /^[\x00-\x7F]*$/) would re-enable the injection silently.
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "Test <test@example.com>",
        to: "user@example.com",
        subject: "Hi\r\nBcc: attacker@evil.com",
        html: "<p>x</p>",
        idempotencyKey: "key_inj",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { raw: string };
      // Must NOT contain a literal injected Bcc header.
      expect(msg.raw).not.toMatch(/^Bcc:/m);
      // Subject MUST be base64-wrapped (CR/LF triggers the encoder).
      expect(msg.raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
      // The literal "Bcc: attacker" string must not appear anywhere
      // (the base64-encoded payload renders as opaque bytes; only after
      // an MUA decodes it would 'Bcc: attacker' appear inside the SUBJECT
      // field — NOT as a separate header).
      const decodedB64 = msg.raw.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/)?.[1];
      expect(decodedB64).toBeDefined();
      // Decoding proves the Bcc text is INSIDE the subject (a single
      // header value), not a separately-injected header line.
      const decoded = atob(decodedB64!);
      expect(decoded).toContain("Bcc: attacker@evil.com");
    });

    test("DEFENSE: CR/LF in From display name is filtered (extractName drops + bare-email fallback)", async () => {
      // Same header-injection class via the display-name portion of From.
      // extractName's regex `/^(.+?)\s*<.+>$/` requires single-line match
      // (no /s flag, no /m flag), so a name containing CR/LF causes the
      // whole regex to fail — extractName returns "" — and the
      // From-builder takes the bare-email branch (no display name at all).
      // Either way, no injected header reaches the wire.
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "Evil\r\nBcc: x@y.z <test@example.com>",
        to: "user@example.com",
        subject: "hi",
        html: "<p>x</p>",
        idempotencyKey: "key_inj_from",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { raw: string };
      // Critically: NO injected Bcc header on the wire.
      expect(msg.raw).not.toMatch(/^Bcc:/m);
      // The literal injected substring must not survive ANYWHERE in raw.
      expect(msg.raw).not.toContain("Bcc: x@y.z");
      // Display name dropped entirely — bare-email From only.
      expect(msg.raw).toMatch(/From: test@example\.com\r\n/);
    });

    test("From header omits display name when sender has no name", async () => {
      // When the From string is a bare email, the header must be just the
      // address (no '<...>' wrapper, no leading space). This exercises the
      // fallback branch in createMimeMessage.
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "sender@example.com",
        to: "user@example.com",
        subject: "hi",
        html: "<p>x</p>",
        idempotencyKey: "key_bare",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { raw: string };
      expect(msg.raw).toContain("From: sender@example.com\r\n");
      expect(msg.raw).not.toContain("<sender@example.com>");
    });

    test("raw MIME has CRLF line endings AND a properly-closed multipart boundary", async () => {
      // Pins two RFC-5322/2046 invariants that would silently render
      // emails unparseable for some MUAs (Outlook, mobile clients):
      //   (1) Headers and boundaries MUST use \r\n (not bare \n) — a
      //       regression to .join('\n') would break strict SMTP parsers.
      //   (2) The closing boundary MUST end with `--` per RFC 2046 §5.1
      //       — dropping the `--` produces a half-open multipart that
      //       some clients treat as 'truncated email body'.
      mockSend.mockResolvedValueOnce(undefined);
      const provider = new CloudflareProvider(mockBinding);
      await provider.send({
        from: "Test <test@example.com>",
        to: "user@example.com",
        subject: "hi",
        html: "<p>body</p>",
        idempotencyKey: "key_mime",
      });
      const msg = mockSend.mock.calls[0]?.[0] as { raw: string };
      // CRLF check: every header line ends with \r\n
      expect(msg.raw).toMatch(/MIME-Version: 1\.0\r\n/);
      expect(msg.raw).toMatch(/Content-Type: multipart\/alternative; boundary="----cf[a-f0-9]+"\r\n/);
      // The opening boundary must appear once with leading `--`
      const openingMatch = msg.raw.match(/\r\n--(----cf[a-f0-9]+)\r\n/);
      expect(openingMatch).not.toBeNull();
      const boundary = openingMatch![1]!;
      // Closing boundary MUST end with `--`
      expect(msg.raw).toContain(`\r\n--${boundary}--`);
      // The html body must appear AFTER the part headers, not before.
      const htmlIdx = msg.raw.indexOf("<p>body</p>");
      const partHeaderIdx = msg.raw.indexOf("Content-Type: text/html");
      expect(partHeaderIdx).toBeGreaterThan(0);
      expect(htmlIdx).toBeGreaterThan(partHeaderIdx);
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
      // Pin the FINAL UPDATE: status='sent' with completed_at timestamp
      // bound by the key. Without this, a regression that DROPPED the
      // success-update would leave the row stuck in 'pending' forever —
      // every future send with the same key would throw 'Concurrent send'
      // and never recover. The bug would only show up on the SECOND
      // attempted retry of any key, easy to miss in dev.
      const sentCall = mockPrepare.mock.calls.find((c) =>
        (c[0] as string).includes("status = 'sent'"),
      );
      expect(sentCall).toBeDefined();
      // The bind for the sent-update must include the key (not, say, the
      // raw email body or some other field by accident).
      const sentBindCall = mockBind.mock.calls.find((c) => c.includes("key_123"));
      expect(sentBindCall).toBeDefined();
    });

    test("throws IdempotentSendResult when already sent", async () => {
      mockRun.mockResolvedValueOnce({ meta: { changes: 0 } }); // INSERT ignored (exists)
      mockFirst.mockResolvedValueOnce({ status: "sent" });

      const provider = new CloudflareProvider(mockBinding, mockDb);

      await expect(provider.send(sendParams)).rejects.toThrow(IdempotentSendResult);
      // CRITICAL idempotency contract: when the slot is already 'sent'
      // we MUST NOT invoke the email binding again. A regression that
      // sent the email AND THEN threw IdempotentSendResult would silently
      // double-deliver to the recipient — the throw itself proves
      // nothing about whether mockSend was called.
      expect(mockSend).not.toHaveBeenCalled();
    });

    test("throws on concurrent pending send", async () => {
      mockRun.mockResolvedValueOnce({ meta: { changes: 0 } }); // INSERT ignored
      mockFirst.mockResolvedValueOnce({ status: "pending" });

      const provider = new CloudflareProvider(mockBinding, mockDb);

      await expect(provider.send(sendParams)).rejects.toThrow("Concurrent send");
      // CRITICAL: when another worker holds the slot in 'pending' state
      // we MUST NOT also send. A regression that proceeded with send
      // anyway would race two deliveries through the email binding.
      expect(mockSend).not.toHaveBeenCalled();
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
      // Pin: send was invoked EXACTLY ONCE on the reclaimed slot.
      // A regression that retried at both the reclaim and outer-send
      // layer would invoke the binding twice, double-delivering when
      // the first attempt actually succeeded but appeared to fail.
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Pin envelope was built from sendParams (not a stale or debug
      // payload from the previously-failed attempt).
      const reclaimMsg = mockSend.mock.calls[0]?.[0] as { to: string };
      expect(reclaimMsg.to).toBe("user@example.com");
    });

    test("throws when failed-slot reclaim loses race (changes=0)", async () => {
      // Status was 'failed' when we read it, but another retry beat us to
      // the conditional UPDATE. The reclaim must report changes=0 and we
      // must surface a concurrent-send error rather than silently sending.
      mockRun
        .mockResolvedValueOnce({ meta: { changes: 0 } }) // INSERT ignored
        .mockResolvedValueOnce({ meta: { changes: 0 } }); // reclaim lost the race
      mockFirst.mockResolvedValueOnce({ status: "failed" });

      const provider = new CloudflareProvider(mockBinding, mockDb);
      await expect(provider.send(sendParams)).rejects.toThrow(
        "Concurrent send for same idempotency key",
      );
      // Critically: we must NOT have invoked the email binding.
      expect(mockSend).not.toHaveBeenCalled();
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
      // Pin the bind: the failed-update MUST target THIS key, not some
      // other row. A regression binding the wrong arg (e.g. params.to)
      // would mark unrelated rows failed and leave THIS row stuck pending.
      const failedBindCall = mockBind.mock.calls.find((c) => c.includes("key_123"));
      expect(failedBindCall).toBeDefined();
      // CRITICAL: the success-update must NOT have run after the throw.
      const sentCall = mockPrepare.mock.calls.find((c) =>
        (c[0] as string).includes("status = 'sent'"),
      );
      expect(sentCall).toBeUndefined();
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
      // Pin the row-disappeared race: send must have been invoked
      // EXACTLY ONCE (a regression that retried the lookup and tried
      // to send again would double-deliver), AND the success-UPDATE
      // (status='sent') must have been issued so the slot reflects
      // delivery (a regression that skipped the update on the null-
      // lookup branch would leave the recreated row stuck pending).
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentSql = mockPrepare.mock.calls.find((c) =>
        (c[0] as string).includes("status = 'sent'"),
      );
      expect(sentSql).toBeDefined();
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
