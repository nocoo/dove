import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashEmail } from "@/lib/email-hash";
import {
	AUTHOR_PROFILE_URL,
	EMPTY_AUTHOR_PROFILE,
	fetchAuthorProfile,
	parseAuthorProfile,
} from "../lib/author-profile";

const ARCHITIE = "architie@gmail.com";
const ARCHITIE_HASH = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";
const AVATAR = "https://cdn.example.com/avatar-80.jpg";

describe("parseAuthorProfile", () => {
	test("reads name and avatar strings", () => {
		expect(parseAuthorProfile({ name: "Zheng Li", avatar: AVATAR })).toEqual({
			name: "Zheng Li",
			avatar: AVATAR,
		});
	});

	test("maps miss payload to nulls", () => {
		expect(parseAuthorProfile({ name: null, avatar: null })).toEqual(EMPTY_AUTHOR_PROFILE);
	});

	test("ignores email id and slug if present", () => {
		expect(
			parseAuthorProfile({
				name: "Zheng Li",
				avatar: AVATAR,
				email: "secret@example.com",
				id: "abc",
				slug: "zheng-li",
			}),
		).toEqual({ name: "Zheng Li", avatar: AVATAR });
	});

	test("rejects non-objects and non-string fields", () => {
		expect(parseAuthorProfile(null)).toEqual(EMPTY_AUTHOR_PROFILE);
		expect(parseAuthorProfile("Zheng Li")).toEqual(EMPTY_AUTHOR_PROFILE);
		expect(parseAuthorProfile({ name: 1, avatar: 2 })).toEqual(EMPTY_AUTHOR_PROFILE);
	});
});

describe("fetchAuthorProfile", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetch);
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("GETs lizheng.blog with the SHA-256 hash and no email", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ name: "Zheng Li", avatar: AVATAR }),
		});

		await expect(fetchAuthorProfile(ARCHITIE)).resolves.toEqual({
			name: "Zheng Li",
			avatar: AVATAR,
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
		expect(url).toBe(`${AUTHOR_PROFILE_URL}?hash=${ARCHITIE_HASH}`);
		expect(url).not.toContain("@");
		expect(url).not.toContain("architie");
		expect(init?.method ?? "GET").toBe("GET");
		expect(JSON.stringify(init ?? {})).not.toContain(ARCHITIE);
		expect(await hashEmail(ARCHITIE)).toBe(ARCHITIE_HASH);
	});

	test("returns nulls on miss payload", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ name: null, avatar: null }),
		});
		await expect(fetchAuthorProfile("nobody@example.com")).resolves.toEqual(EMPTY_AUTHOR_PROFILE);
	});

	test("returns nulls on 429", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			json: () => Promise.resolve({ error: "rate limited" }),
		});
		await expect(fetchAuthorProfile(ARCHITIE)).resolves.toEqual(EMPTY_AUTHOR_PROFILE);
	});

	test("returns nulls when fetch throws", async () => {
		mockFetch.mockRejectedValueOnce(new Error("network down"));
		await expect(fetchAuthorProfile(ARCHITIE)).resolves.toEqual(EMPTY_AUTHOR_PROFILE);
	});

	test("returns nulls when JSON is invalid", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.reject(new SyntaxError("bad json")),
		});
		await expect(fetchAuthorProfile(ARCHITIE)).resolves.toEqual(EMPTY_AUTHOR_PROFILE);
	});
});
