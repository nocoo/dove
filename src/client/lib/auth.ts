export interface User {
	email: string;
	name: string;
}

export async function fetchUser(): Promise<User | null> {
	const res = await fetch("/api/auth/me");
	if (!res.ok) return null;
	const data = (await res.json()) as { user: User | null };
	return data.user;
}

export function signOut(): void {
	window.location.href = "/api/auth/signout";
}
