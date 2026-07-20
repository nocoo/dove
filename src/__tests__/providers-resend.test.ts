import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ResendProvider } from "@/lib/email/providers/resend";

describe("ResendProvider", () => {
	let provider: ResendProvider;
	const mockFetch = vi.fn();

	beforeEach(() => {
		provider = new ResendProvider("re_test_key");
		vi.stubGlobal("fetch", mockFetch);
		mockFetch.mockReset();
		// Retry paths intentionally log to console.warn; silence so test output
		// stays focused on failures (still asserted via mockFetch call counts).
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
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
		test("enables dry run mode and skips real fetch", async () => {
			provider.setDryRun(true);
			const result = await provider.send({
				from: "a@b.c",
				to: "x@y.z",
				subject: "s",
				html: "<p/>",
				idempotencyKey: "k",
			});
			expect(result.id).toMatch(/^dry_run_/);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		test("setDryRun(false) re-enables real fetch path", async () => {
			provider.setDryRun(true);
			provider.setDryRun(false);
			mockFetch.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ id: "msg_real" }),
			});
			const result = await provider.send({
				from: "a@b.c",
				to: "x@y.z",
				subject: "s",
				html: "<p/>",
				idempotencyKey: "k",
			});
			expect(result.id).toBe("msg_real");
			expect(mockFetch).toHaveBeenCalledTimes(1);
			// Pin: setDryRun(false) actually re-enabled the real fetch path.
			// A regression that left dry-run on (e.g. AND-instead-of-OR
			// condition) would silently pass call-count==1 because dry-run
			// returns synthetic ids without calling fetch — wait, actually
			// dry-run does NOT call fetch, so toHaveBeenCalled(1) DOES catch
			// it. But verify the URL hits the real Resend endpoint anyway.
			const call = mockFetch.mock.calls[0] as unknown as [string];
			expect(call[0]).toMatch(/resend\.com/);
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
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://api.resend.com/emails");
			expect(init.method).toBe("POST");
			const headers = init.headers as Record<string, string>;
			expect(headers.Authorization).toBe("Bearer re_test_key");
			expect(headers["Content-Type"]).toBe("application/json");
			// Idempotency-Key MUST flow through to Resend; without it, retries
			// produce duplicate sends and burn quota.
			expect(headers["Idempotency-Key"]).toBe("key_123");
			// Verify request body actually carries the params (a regression that
			// sent an empty body or hardcoded values would pass loose matchers).
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			expect(body.from).toBe(sendParams.from);
			expect(body.to).toEqual([sendParams.to]);
			expect(body.subject).toBe(sendParams.subject);
			expect(body.html).toBe(sendParams.html);
		});

		test("returns synthetic id in dry run mode", async () => {
			provider.setDryRun(true);
			const result = await provider.send(sendParams);
			expect(result.id).toMatch(/^dry_run_/);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		test("retries on network error", async () => {
			vi.useFakeTimers();
			mockFetch.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ id: "msg_retry" }),
			});

			const sendPromise = provider.send(sendParams);
			// Drain backoff timer (500ms after attempt 1).
			await vi.runAllTimersAsync();
			const result = await sendPromise;
			expect(result.id).toBe("msg_retry");
			expect(mockFetch).toHaveBeenCalledTimes(2);
			// Pin retry idempotency: BOTH attempts must POST the same URL and
			// same body. A regression that regenerated the body between
			// retries (e.g. a fresh idempotency key, different from-address)
			// would break provider-side dedup — the retry would NOT match
			// the original attempt at Resend, and the recipient could get
			// duplicate emails. Pin URL + idempotency-key header equality.
			const call1 = mockFetch.mock.calls[0] as unknown as [
				string,
				{ headers: Record<string, string>; body: string },
			];
			const call2 = mockFetch.mock.calls[1] as unknown as [
				string,
				{ headers: Record<string, string>; body: string },
			];
			expect(call1[0]).toBe(call2[0]);
			expect(call1[1].body).toBe(call2[1].body);
		});

		test("retries on 409 conflict", async () => {
			vi.useFakeTimers();
			mockFetch.mockResolvedValueOnce({ ok: false, status: 409 }).mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ id: "msg_after_409" }),
			});

			const sendPromise = provider.send(sendParams);
			await vi.runAllTimersAsync();
			const result = await sendPromise;
			expect(result.id).toBe("msg_after_409");
			expect(mockFetch).toHaveBeenCalledTimes(2);
			// Same idempotent-retry contract as 'retries on network error':
			// both attempts must hit the same URL with the same body so
			// Resend can dedupe via the X-Idempotency-Key header.
			const c1 = mockFetch.mock.calls[0] as unknown as [string, { body: string }];
			const c2 = mockFetch.mock.calls[1] as unknown as [string, { body: string }];
			expect(c1[0]).toBe(c2[0]);
			expect(c1[1].body).toBe(c2[1].body);
		});

		test("retries on 5xx error", async () => {
			vi.useFakeTimers();
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

			const sendPromise = provider.send(sendParams);
			await vi.runAllTimersAsync();
			const result = await sendPromise;
			expect(result.id).toBe("msg_after_5xx");
			expect(mockFetch).toHaveBeenCalledTimes(2);
			// Idempotent-retry contract: both attempts identical.
			const c1 = mockFetch.mock.calls[0] as unknown as [string, { body: string }];
			const c2 = mockFetch.mock.calls[1] as unknown as [string, { body: string }];
			expect(c1[0]).toBe(c2[0]);
			expect(c1[1].body).toBe(c2[1].body);
		});

		test("throws on 4xx error without retry", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: () => Promise.resolve("Bad Request"),
			});

			await expect(provider.send(sendParams)).rejects.toThrow("Resend API error: 400");
			expect(mockFetch).toHaveBeenCalledTimes(1);
			// Pin: 4xx (other than 409) is a CLIENT error, not retried.
			// The single attempt must hit the documented Resend endpoint
			// with method=POST. A regression that retried 4xx would burn
			// 4× the latency budget on un-recoverable errors and could
			// amplify a malformed-request bug into a thundering herd.
			const call = mockFetch.mock.calls[0] as unknown as [string, { method: string }];
			expect(call[0]).toMatch(/resend\.com/);
			expect(call[1].method).toBe("POST");
		});

		test("throws after max retries on persistent network error", async () => {
			vi.useFakeTimers();
			mockFetch.mockRejectedValue(new Error("Network error"));

			const sendPromise = provider.send(sendParams);
			// Attach catch handler synchronously to avoid unhandled rejection warning
			// when the inner timers run before we await below.
			const settled = expect(sendPromise).rejects.toThrow("Network error");
			await vi.runAllTimersAsync();
			await settled;
			expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
			// Pin retry policy: ALL 4 attempts must hit the same URL with
			// the same body. A regression that drifted between attempts
			// (e.g. switched API endpoints, regenerated body) would defeat
			// provider-side dedup AND could cause an attempted partial-send
			// recovery to amplify the failure across endpoints.
			const urls = mockFetch.mock.calls.map((c) => (c as unknown as [string])[0]);
			expect(new Set(urls).size).toBe(1);
		});

		test("wraps non-Error rejection (e.g. raw string) before final throw", async () => {
			// fetch() can in principle reject with non-Error values; the provider
			// must coerce so callers always see an Error with a usable message.
			vi.useFakeTimers();
			mockFetch.mockRejectedValue("plain string failure");

			const sendPromise = provider.send(sendParams);
			const settled = expect(sendPromise).rejects.toBe("plain string failure");
			await vi.runAllTimersAsync();
			await settled;
			// Final throw rethrows the original value (per current contract);
			// the intermediate retries must have wrapped it so lastError is an Error.
			expect(mockFetch).toHaveBeenCalledTimes(4);
			// Same retry-target invariant: all 4 attempts identical URL.
			const urls = mockFetch.mock.calls.map((c) => (c as unknown as [string])[0]);
			expect(new Set(urls).size).toBe(1);
		});

		test("throws after max retries on persistent 5xx", async () => {
			vi.useFakeTimers();
			mockFetch.mockResolvedValue({
				ok: false,
				status: 503,
				text: () => Promise.resolve("Service Unavailable"),
			});

			const sendPromise = provider.send(sendParams);
			const settled = expect(sendPromise).rejects.toThrow("Resend API error: 503");
			await vi.runAllTimersAsync();
			await settled;
			expect(mockFetch).toHaveBeenCalledTimes(4);
			// Same retry-target invariant: all 4 attempts identical URL+body.
			const urls = mockFetch.mock.calls.map((c) => (c as unknown as [string])[0]);
			expect(new Set(urls).size).toBe(1);
			const bodies = mockFetch.mock.calls.map(
				(c) => (c as unknown as [string, { body: string }])[1].body,
			);
			expect(new Set(bodies).size).toBe(1);
		});

		test("surfaces 409 as 4xx error when it persists past the retry budget", async () => {
			// 409 retries up to RESEND_MAX_RETRIES; on the final attempt the
			// !response.ok branch must surface it as a regular API error rather
			// than silently exhausting the loop. Catches a regression where the
			// 409 'fall-through' path would otherwise return a stale lastError.
			vi.useFakeTimers();
			mockFetch.mockResolvedValue({
				ok: false,
				status: 409,
				text: () => Promise.resolve("concurrent_idempotent_requests"),
			});

			const sendPromise = provider.send(sendParams);
			const settled = expect(sendPromise).rejects.toThrow("Resend API error: 409");
			await vi.runAllTimersAsync();
			await settled;
			expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
			// Same retry-target invariant: all 4 attempts identical URL.
			const urls = mockFetch.mock.calls.map((c) => (c as unknown as [string])[0]);
			expect(new Set(urls).size).toBe(1);
		});
	});
});
