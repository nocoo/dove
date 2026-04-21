export interface User {
  email: string;
  name: string;
  image: string | null;
}

export async function fetchUser(): Promise<User | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const data = (await res.json()) as { user: User | null };
  return data.user;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/signout", { method: "POST" });
  window.location.href = "/login";
}
