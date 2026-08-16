export async function hashEmail(email: string): Promise<string> {
	const normalized = email.trim().toLowerCase();
	const bytes = new TextEncoder().encode(normalized);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
