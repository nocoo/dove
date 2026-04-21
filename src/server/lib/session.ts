import { nanoid } from "nanoid";

const SESSION_PREFIX = "dove_session:";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionData {
  email: string;
  name: string;
  image: string | null;
  createdAt: string;
}

export async function createSession(
  kv: KVNamespace,
  data: Omit<SessionData, "createdAt">,
): Promise<string> {
  const token = nanoid(48);
  const session: SessionData = {
    ...data,
    createdAt: new Date().toISOString(),
  };
  await kv.put(SESSION_PREFIX + token, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function getSession(
  kv: KVNamespace,
  token: string,
): Promise<SessionData | null> {
  const raw = await kv.get(SESSION_PREFIX + token);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(SESSION_PREFIX + token);
}

export const SESSION_COOKIE_NAME = "dove_session";
export const SESSION_TTL = SESSION_TTL_SECONDS;
