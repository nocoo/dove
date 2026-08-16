import { hashEmail } from "@/lib/email-hash";

export const AUTHOR_PROFILE_URL = "https://lizheng.blog/api/authors/profile";

export type AuthorProfile = {
	name: string | null;
	avatar: string | null;
};

export const EMPTY_AUTHOR_PROFILE: AuthorProfile = { name: null, avatar: null };

export async function fetchAuthorProfile(email: string): Promise<AuthorProfile> {
	const hash = await hashEmail(email);
	try {
		const res = await fetch(`${AUTHOR_PROFILE_URL}?hash=${encodeURIComponent(hash)}`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return EMPTY_AUTHOR_PROFILE;
		return parseAuthorProfile(await res.json());
	} catch {
		return EMPTY_AUTHOR_PROFILE;
	}
}

export function parseAuthorProfile(body: unknown): AuthorProfile {
	if (typeof body !== "object" || body === null) return EMPTY_AUTHOR_PROFILE;
	const rec = body as Record<string, unknown>;
	return {
		name: typeof rec.name === "string" ? rec.name : null,
		avatar: typeof rec.avatar === "string" ? rec.avatar : null,
	};
}
