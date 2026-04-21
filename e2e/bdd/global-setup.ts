/**
 * Playwright global setup — initialize D1 schema before tests.
 *
 * When using local D1 (wrangler dev without remote=true), the database
 * starts empty. This calls POST /api/db/init to create all tables
 * (idempotent, uses CREATE IF NOT EXISTS).
 */

const L3_PORT = 27034;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

export default async function globalSetup() {
  // Wait for server to be ready (Playwright webServer may still be starting)
  const liveUrl = `http://localhost:${L3_PORT}/api/live`;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(liveUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Initialize schema
  const initRes = await fetch(`http://localhost:${L3_PORT}/api/db/init`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Schema init failed (${initRes.status}): ${text}`);
  }

  const body = (await initRes.json()) as { ok: boolean; statements: number };
  console.log(`D1 schema initialized (${body.statements} statements)`);
}
